import { useEffect, useRef, useState } from 'react';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import Graphic from '@arcgis/core/Graphic';
import '@arcgis/core/assets/esri/themes/light/main.css';
import supabase from '../helper/SupabaseClients';
import { normalizeInstituteId } from '../admin/data/SensorDirectoryData';
import { fetchMapSensors, getSensorCoordinates } from './TrafficSensorData';
import styles from './EsriMap.module.css';
import sensorBadge from './assets/sensor.svg';
import selectedSensorBadge from './assets/sensor-selected.svg';

export default function TrafficSensorMap({ embedded = false, instituteId, sensorId, onSensorClick }) {
  const mapDiv = useRef(null);
  const selectionRef = useRef({ sensorId, onSensorClick });
  const [errorMessage, setErrorMessage] = useState(null);
  useEffect(() => {
    selectionRef.current = { sensorId, onSensorClick };
  }, [sensorId, onSensorClick]);

  useEffect(() => {
    const markerSymbol = (selected) => ({
      type: 'picture-marker',
      url: selected ? selectedSensorBadge : sensorBadge,
      width: selected ? '52px' : '40px',
      height: selected ? '52px' : '40px',
    });
    const sensorRenderer = () => ({
      type: 'unique-value', field: 'sensor_id', defaultSymbol: markerSymbol(false),
      uniqueValueInfos: selectionRef.current.sensorId
        ? [{ value: selectionRef.current.sensorId, symbol: markerSymbol(true) }] : [],
    });
    const layer = new FeatureLayer({
      title: 'Transportation sensors', source: [],
      geometryType: 'point', spatialReference: { wkid: 4326 },
      objectIdField: 'ObjectID', outFields: ['*'], popupEnabled: false,
      fields: [
        { name: 'ObjectID', type: 'oid' },
        ...['sensor_id', 'institute_id', 'area_name', 'corridor_name']
          .map((name) => ({ name, type: 'string' })),
        { name: 'latitude', type: 'double' }, { name: 'longitude', type: 'double' },
      ],
      renderer: sensorRenderer(),
      featureReduction: {
        type: 'cluster', clusterRadius: '70px',
        clusterMinSize: '32px', clusterMaxSize: '48px', maxScale: 5000,
        renderer: {
          type: 'simple', symbol: {
            type: 'simple-marker', color: '#234e48',
            outline: { color: '#ffffff', width: 2 },
          },
        },
        labelingInfo: [{
          where: 'cluster_count > 1', labelPlacement: 'center-center',
          labelExpressionInfo: { expression: "Text($feature.cluster_count, '#,###')" },
          symbol: { type: 'text', color: '#ffffff',
            font: { family: 'Arial', size: 11, weight: 'bold' } },
        }],
        popupEnabled: false,
      },
    });
    const view = new MapView({
      container: mapDiv.current,
      map: new Map({ basemap: 'gray-vector', layers: [layer] }),
      center: [-117.234, 32.8801], zoom: 15,
      constraints: { rotationEnabled: false },
      popupEnabled: false,
      ui: { components: ['zoom', 'attribution'] },
    });
    let disposed = false;
    let loading = false;
    let pending = false;
    let fitted = false;
    let previousSelection = '';
    let previousPosition = '';
    let hoverRequest = 0;
    const objectIds = new globalThis.Map();
    let nextObjectId = 1;
    let savedGraphics = new globalThis.Map();
    const updateSelection = () => { layer.renderer = sensorRenderer(); };
    const scope = instituteId ? normalizeInstituteId(instituteId) : undefined;
    const refresh = async () => {
      if (disposed) return;
      if (loading) { pending = true; return; }
      loading = true;
      try {
        const sensors = await fetchMapSensors(supabase, scope);
        await view.when();
        if (disposed) return;
        const graphics = sensors.flatMap((sensor) => {
          const coordinates = getSensorCoordinates(sensor);
          if (!coordinates) return [];
          if (!objectIds.has(sensor.sensor_id)) objectIds.set(sensor.sensor_id, nextObjectId++);
          return [new Graphic({
            geometry: { type: 'point', ...coordinates, spatialReference: { wkid: 4326 } },
            attributes: { ...sensor, ObjectID: objectIds.get(sensor.sensor_id) },
          })];
        });
        const nextGraphics = new globalThis.Map(graphics.map((graphic) => [graphic.attributes.sensor_id, graphic]));
        const addFeatures = [];
        const updateFeatures = [];
        const deleteFeatures = [];
        nextGraphics.forEach((graphic, id) => {
          const previous = savedGraphics.get(id);
          if (!previous) addFeatures.push(graphic);
          else if (JSON.stringify(previous.attributes) !== JSON.stringify(graphic.attributes)) updateFeatures.push(graphic);
        });
        savedGraphics.forEach((graphic, id) => {
          if (!nextGraphics.has(id)) deleteFeatures.push(graphic);
        });
        if (addFeatures.length || updateFeatures.length || deleteFeatures.length) {
          await layer.load();
          if (disposed) return;
          const result = await layer.applyEdits({ addFeatures, updateFeatures, deleteFeatures });
          const failure = [...result.addFeatureResults, ...result.updateFeatureResults, ...result.deleteFeatureResults]
            .find((entry) => entry.error);
          if (failure) throw failure.error;
        }
        if (disposed) return;
        savedGraphics = nextGraphics;
        updateSelection();
        setErrorMessage(null);
        const selected = graphics.find((graphic) => graphic.attributes.sensor_id === selectionRef.current.sensorId);
        const position = selected ? `${selected.geometry.latitude},${selected.geometry.longitude}` : '';
        if (selected && (previousSelection !== selectionRef.current.sensorId || previousPosition !== position)) {
          await view.goTo({ target: selected, zoom: 18 }, { animate: false });
          fitted = true;
        } else if (!fitted && graphics.length) {
          await view.goTo(graphics.length === 1 ? { target: graphics[0], zoom: 17 } : graphics, { animate: false });
          fitted = true;
        }
        previousSelection = selectionRef.current.sensorId;
        previousPosition = position;
      } catch (error) {
        if (!disposed) {
          console.error('Transportation map refresh failed:', error);
          setErrorMessage('Sensor locations could not refresh. Retrying automatically…');
        }
      } finally {
        loading = false;
        if (pending && !disposed) { pending = false; void refresh(); }
      }
    };
    const click = view.on('click', async (event) => {
      try {
        const result = await view.hitTest(event, { include: [layer] });
        if (disposed) return;
        const graphic = result.results.find((hit) => hit.graphic?.layer === layer)?.graphic;
        if (!graphic) return;
        if (graphic.isAggregate) {
          const layerView = await view.whenLayerView(layer);
          const query = layerView.createQuery();
          query.aggregateIds = [graphic.getObjectId()];
          const { extent } = await layerView.queryExtent(query);
          if (disposed) return;
          await view.goTo(extent && extent.width > 0 && extent.height > 0
            ? extent.expand(1.8)
            : { target: graphic.geometry, zoom: view.zoom + 2 });
        } else {
          selectionRef.current.onSensorClick?.(graphic.attributes);
        }
      } catch (error) {
        if (!disposed) console.error('Sensor selection failed:', error);
      }
    });
    const hover = view.on('pointer-move', async (event) => {
      const request = ++hoverRequest;
      try {
        const result = await view.hitTest(event, { include: [layer] });
        if (disposed || request !== hoverRequest) return;
        const graphic = result.results.find((hit) => hit.graphic?.layer === layer)?.graphic;
        view.container.style.cursor = graphic ? 'pointer' : '';

      } catch (error) {
        if (!disposed) console.error('Sensor hover failed:', error);
      }
    });
    const clearHover = () => {
      ++hoverRequest;
      view.container.style.cursor = '';
    };
    mapDiv.current.addEventListener('pointerleave', clearHover);
    // Polling also covers projects where sensors are not enabled for Realtime.
    const interval = setInterval(refresh, 10000);
    const channel = supabase?.channel(`traffic-map-${scope || 'all'}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sensors' }, refresh)
      .subscribe();
    window.addEventListener('focus', refresh);
    const selectionChanged = () => {
      updateSelection();
      void refresh();
    };
    mapDiv.current.addEventListener('sensor-selection', selectionChanged);
    const container = mapDiv.current;
    void refresh();
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      container.removeEventListener('sensor-selection', selectionChanged);
      container.removeEventListener('pointerleave', clearHover);
      if (channel) void supabase.removeChannel(channel);
      click.remove();
      hover.remove();
      view.destroy();
    };
  }, [instituteId]);

  useEffect(() => {
    mapDiv.current?.dispatchEvent(new Event('sensor-selection'));
  }, [sensorId]);

  return <div className={`${styles.mapWrapper} ${embedded ? styles.embedded : ''}`}>
    <div ref={mapDiv} className={styles.mapDiv} />
    {errorMessage && <div className={styles.sensorStatus} role="status">{errorMessage}</div>}
  </div>;
}
