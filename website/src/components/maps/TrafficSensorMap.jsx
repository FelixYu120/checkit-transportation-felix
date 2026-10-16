import { useEffect, useRef, useState } from 'react';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import GeoJSONLayer from '@arcgis/core/layers/GeoJSONLayer';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import Graphic from '@arcgis/core/Graphic';
import '@arcgis/core/assets/esri/themes/light/main.css';
import supabase from '../helper/SupabaseClients';
import { prepareSensorLogo, replaceSensorGlyph, preloadMarkerImages } from './TrafficSensorSymbols';
import { normalizeInstituteId } from '../admin/data/SensorDirectoryData';
import { addHeadingPointer, fetchMapSensors, getSensorCoordinates, getSensorHeading } from './TrafficSensorData';
import styles from './EsriMap.module.css';
import { getSensorCountBadge, getSensorOverview, SENSOR_CLUSTER_SIZE, SENSOR_OVERVIEW_ZOOM } from './TrafficSensorOverview';
import { colorSensorBadge, fetchMapSensorHealth, getAggregateMapHealth, getMapSensorHealth, SENSOR_HEALTH_COLORS } from './TrafficSensorHealth';
import sensorBadgeSvg from './assets/sensor.svg?raw';
import selectedSensorBadgeSvg from './assets/sensor-selected.svg?raw';

export default function TrafficSensorMap({ embedded = false, instituteId, sensorId, onSensorClick }) {
  const mapDiv = useRef(null);
  const selectionRef = useRef({ sensorId, onSensorClick });
  const [errorMessage, setErrorMessage] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  useEffect(() => {
    selectionRef.current = { sensorId, onSensorClick };
  }, [sensorId, onSensorClick]);

  useEffect(() => {
    let savedGraphics = new globalThis.Map();
    const logoReady = prepareSensorLogo(`${import.meta.env.BASE_URL}checkmark.png`);
    let logoDataUrl;
    const markerSymbol = (selected, heading, health = 'unknown') => {
      const svg = replaceSensorGlyph(colorSensorBadge(selected ? selectedSensorBadgeSvg : sensorBadgeSvg, health), logoDataUrl);
      return {
        type: 'picture-marker',
        url: addHeadingPointer(svg, heading, selected, SENSOR_HEALTH_COLORS[health]) ||
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        width: '44px', height: '44px',
      };
    };
    const sensorRenderer = () => ({
      type: 'unique-value', field: 'sensor_id',
      uniqueValueInfos: Array.from(savedGraphics.values(), (graphic) => ({
        value: graphic.attributes.sensor_id,
        symbol: markerSymbol(graphic.attributes.sensor_id === selectionRef.current.sensorId, graphic.attributes.heading_degrees, graphic.attributes.map_health),
      })),
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
        { name: 'heading_degrees', type: 'double' },
        { name: 'map_health', type: 'string' },
        { name: 'health_bad', type: 'integer' }, { name: 'health_known', type: 'integer' },
      ],
      renderer: sensorRenderer(),
      featureReduction: {
        type: 'cluster', clusterRadius: '70px',
        clusterMinSize: SENSOR_CLUSTER_SIZE, clusterMaxSize: SENSOR_CLUSTER_SIZE, maxScale: 5000,
        fields: [
          { name: 'sensor_count', statisticType: 'count', onStatisticField: 'ObjectID' },
          { name: 'unhealthy_count', statisticType: 'sum', onStatisticField: 'health_bad' },
          { name: 'known_count', statisticType: 'sum', onStatisticField: 'health_known' },
        ],
        labelingInfo: [],
        // Count and circle share one image; no separately delayed cluster labels.
        renderer: { type: 'unique-value', valueExpression: "$feature.sensor_count + ':' + When($feature.unhealthy_count > 0, 'down', $feature.known_count == $feature.sensor_count, 'active', 'unknown')", uniqueValueInfos: [] },
        popupEnabled: false,
      },
    });
    const landmarksLayer = new GeoJSONLayer({
      title: 'Campus buildings',
      url: `${import.meta.env.BASE_URL}campus-landmarks.geojson`,
      copyright: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> (ODbL)',
      // Building names appear only at close zoom (about zoom 18).
      outFields: ['name', 'building_type'], popupEnabled: false, minScale: 3000,
      definitionExpression: "building_type IS NOT NULL AND building_type NOT IN ('no', 'construction', 'parking', 'shed', 'roof', 'ruins') AND name IS NOT NULL AND LOWER(name) NOT LIKE '%untitled%'",
      renderer: { type: 'simple', symbol: { type: 'simple-marker',
        size: 2, color: [0, 0, 0, 0], outline: { width: 0 } } },
      labelingInfo: [{ labelPlacement: 'above-center', deconflictionStrategy: 'static',
        labelExpressionInfo: { expression: '$feature.name' },
        symbol: { type: 'text', color: '#62665f', haloColor: '#ffffff', haloSize: 1.5,
          font: { family: 'Arial', size: 10 } } }],
    });
    const overviewLayer = new GraphicsLayer({ title: 'All mapped sensors', listMode: 'hide' });
    const view = new MapView({
      container: mapDiv.current,
      map: new Map({ basemap: 'streets-vector', layers: [landmarksLayer, layer, overviewLayer] }),
      center: [-117.234, 32.8801], zoom: 15,
      constraints: { rotationEnabled: false },
      popupEnabled: false,
      ui: { components: ['zoom', 'attribution'] },
    });
    let disposed = false;
    // Keep streets and city names, without the dense business/place labels.
    void view.map.basemap.load().then(async () => {
      await Promise.all(view.map.basemap.baseLayers.map(async (basemapLayer) => {
        await basemapLayer.load();
        if (disposed) return;
        for (const styleLayer of basemapLayer.currentStyleInfo?.style?.layers || []) {
          const source = styleLayer['source-layer'] || '';
          const keepLabel = /^(Road|City|Admin)/.test(source);
          // Google Maps-inspired neutrals; green is reserved for planted areas.
          const mapFills = {
            Land: '#f1f0eb', 'Urban area': '#eeede8', Education: '#ecebe5',
            Retail: '#eee9e1', Government: '#e9e8e3', Medical: '#ede9e4',
            'Openspace or forest': '#cedfc7', 'Park or farming': '#d5e5cd',
            'Vegetation small scale': '#cedfc7', 'Golf course': '#d5e5cd',
            'Admin0 forest or park': '#cedfc7', 'Admin1 forest or park': '#cedfc7',
            Beach: '#f2ead4', Pedestrian: '#e9e7e1',
          };
          let paint;
          if (/^Special area of interest\/(Grass|Groundcover|Field|Football|Baseball)/.test(styleLayer.id)) {
            paint = { 'fill-color': '#d5e5cd' };
          } else if (styleLayer.id === 'Building/fill') {
            paint = { 'fill-color': '#dedbd3', 'fill-outline-color': '#cbc8c0' };
          } else if (styleLayer.type === 'fill' && /^(Water area|Marine area|Bathymetry)/.test(source) && !/Ice|Swamp|Playa/.test(styleLayer.id)) {
            paint = { 'fill-color': '#bad8e7' };
          } else if (styleLayer.type === 'fill' && mapFills[source] && styleLayer.id !== 'Land/Ice') {
            paint = { 'fill-color': mapFills[source] };
          } else if (styleLayer.type === 'line' && /^Road/.test(source)) {
            const mainRoad = /Major|Highway|Freeway/.test(styleLayer.id);
            paint = { 'line-color': styleLayer.id.includes('/casing')
              ? '#d7d5cd' : mainRoad ? '#f5e5b8' : '#ffffff' };
          } else if (styleLayer.type === 'symbol' && keepLabel && styleLayer.layout?.['text-field']) {
            paint = { 'text-color': '#62665f', 'text-halo-color': '#ffffff' };
          }
          if (paint) basemapLayer.setPaintProperties(styleLayer.id, { ...styleLayer.paint, ...paint });
          if (styleLayer.type === 'symbol' && !keepLabel) {
            basemapLayer.setStyleLayerVisibility(styleLayer.id, 'none');
          }
        }
      }));
    }).catch((error) => {
      if (!disposed) console.warn('Map style could not be applied:', error);
    });
    let loading = false;
    let pending = false;
    let fitted = false;
    let previousSelection = '';
    let previousPosition = '';
    let hoverRequest = 0;
    const objectIds = new globalThis.Map();
    let nextObjectId = 1;
    let symbolRevision = 0;
    const updateSelection = async () => {
      const revision = ++symbolRevision;
      const renderer = sensorRenderer();
      const clusterRenderer = {
        type: 'unique-value',
        valueExpression: "$feature.sensor_count + ':' + When($feature.unhealthy_count > 0, 'down', $feature.known_count == $feature.sensor_count, 'active', 'unknown')",
        uniqueValueInfos: Array.from({ length: savedGraphics.size }, (_, index) => index + 1)
          .flatMap((count) => Object.keys(SENSOR_HEALTH_COLORS).map((health) => ({
            value: `${count}:${health}`,
            symbol: { type: 'picture-marker', url: getSensorCountBadge(count, health),
              width: SENSOR_CLUSTER_SIZE, height: SENSOR_CLUSTER_SIZE },
          }))),
      };
      await preloadMarkerImages([
        ...renderer.uniqueValueInfos.map(({ symbol }) => symbol.url),
        ...clusterRenderer.uniqueValueInfos.map(({ symbol }) => symbol.url),
      ]);
      if (disposed || revision !== symbolRevision) return;
      layer.renderer = renderer;
      layer.featureReduction.renderer = clusterRenderer;
    };
    const updateOverview = () => {
      if (disposed) return;
      const overview = getSensorOverview(Array.from(savedGraphics.values(), (graphic) => graphic.attributes));
      const merged = view.zoom <= SENSOR_OVERVIEW_ZOOM && overview?.count > 0;
      layer.visible = !merged;
      overviewLayer.visible = Boolean(merged);
      overviewLayer.removeAll();
      if (merged) {
        const geometry = { type: 'point', latitude: overview.latitude,
          longitude: overview.longitude, spatialReference: { wkid: 4326 } };
        overviewLayer.add(new Graphic({
          geometry, attributes: { overview: true, sensor_count: overview.count },
          symbol: { type: 'picture-marker', url: getSensorCountBadge(overview.count, getAggregateMapHealth(Array.from(savedGraphics.values(), (graphic) => graphic.attributes))),
            width: SENSOR_CLUSTER_SIZE, height: SENSOR_CLUSTER_SIZE },
        }));
      }
      if (layer.featureReduction) {
        layer.featureReduction.clusterRadius = view.zoom >= 16 ? 70 : view.zoom >= 15 ? 100 : 140;
      }
      ++hoverRequest;
      setTooltip(null);
    };
    const zoomWatch = reactiveUtils.watch(() => view.zoom, updateOverview, { initial: true });
    const scope = instituteId ? normalizeInstituteId(instituteId) : undefined;
    const refresh = async () => {
      if (disposed) return;
      if (loading) { pending = true; return; }
      loading = true;
      const previousGraphics = savedGraphics;
      let editsCommitted = false;
      try {
        const sensors = await fetchMapSensors(supabase, scope);
        const healthRows = await fetchMapSensorHealth(supabase, sensors.map((sensor) => sensor.sensor_id));
        logoDataUrl = await logoReady;
        await view.when();
        if (disposed) return;
        const graphics = sensors.flatMap((sensor) => {
          const coordinates = getSensorCoordinates(sensor);
          if (!coordinates) return [];
          const health = getMapSensorHealth({ ...sensor, ...healthRows.get(sensor.sensor_id) });
          if (!objectIds.has(sensor.sensor_id)) objectIds.set(sensor.sensor_id, nextObjectId++);
          return [new Graphic({
            geometry: { type: 'point', ...coordinates, spatialReference: { wkid: 4326 } },
            attributes: { ...sensor, ...coordinates,
              map_health: health, health_bad: health === 'down' ? 1 : 0, health_known: health === 'unknown' ? 0 : 1,
              heading_degrees: getSensorHeading(sensor.heading_degrees),
              ObjectID: objectIds.get(sensor.sensor_id) },
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
        savedGraphics = nextGraphics;
        await updateSelection();
        if (addFeatures.length || updateFeatures.length || deleteFeatures.length) {
          await layer.load();
          if (disposed) return;
          const result = await layer.applyEdits({ addFeatures, updateFeatures, deleteFeatures });
          const failure = [...result.addFeatureResults, ...result.updateFeatureResults, ...result.deleteFeatureResults]
            .find((entry) => entry.error);
          if (failure) throw failure.error;
        }
        editsCommitted = true;
        if (disposed) return;
        updateOverview();
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
        if (!editsCommitted) savedGraphics = previousGraphics;
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
        const result = await view.hitTest(event, { include: [layer, overviewLayer] });
        if (disposed) return;
        const graphic = result.results.find((hit) => [layer, overviewLayer].includes(hit.graphic?.layer))?.graphic;
        if (!graphic) return;
        if (graphic.attributes?.overview) {
          await view.goTo({ target: Array.from(savedGraphics.values()), zoom: SENSOR_OVERVIEW_ZOOM + 1 });
        } else if (graphic.isAggregate) {
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
        const result = await view.hitTest(event, { include: [layer, overviewLayer] });
        if (disposed || request !== hoverRequest) return;
        const graphic = result.results.find((hit) => [layer, overviewLayer].includes(hit.graphic?.layer))?.graphic;
        view.container.style.cursor = graphic ? 'pointer' : '';
        const name = graphic && !graphic.isAggregate && !graphic.attributes?.overview ? graphic.attributes.corridor_name : null;
        const tooltipWidth = name ? Math.min(240, String(name).length * 7 + 20) : 0;
        setTooltip(name ? { name,
          x: Math.max(12, Math.min(event.x + 14, view.width - tooltipWidth - 12)),
          y: Math.max(12, Math.min(event.y + 18, view.height - 48)),
        } : null);

      } catch (error) {
        if (!disposed) console.error('Sensor hover failed:', error);
      }
    });
    const clearHover = () => {
      ++hoverRequest;
      view.container.style.cursor = '';
      setTooltip(null);
    };
    mapDiv.current.addEventListener('pointerleave', clearHover);
    mapDiv.current.addEventListener('pointerdown', clearHover);
    mapDiv.current.addEventListener('wheel', clearHover, { passive: true });
    // Polling also covers projects where sensors are not enabled for Realtime.
    const interval = setInterval(refresh, 10000);
    const channel = supabase?.channel(`traffic-map-${scope || 'all'}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sensors' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_health' }, refresh)
      .subscribe();
    window.addEventListener('focus', refresh);
    const selectionChanged = () => {
      clearHover();
      void updateSelection().catch((error) => console.error('Sensor symbols failed:', error));
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
      container.removeEventListener('pointerdown', clearHover);
      container.removeEventListener('wheel', clearHover);
      if (channel) void supabase.removeChannel(channel);
      click.remove();
      hover.remove();
      zoomWatch.remove();
      view.destroy();
    };
  }, [instituteId]);

  useEffect(() => {
    mapDiv.current?.dispatchEvent(new Event('sensor-selection'));
  }, [sensorId]);

  return <div className={`${styles.mapWrapper} ${embedded ? styles.embedded : ''}`}>
    <div ref={mapDiv} className={styles.mapDiv} />
    {tooltip && <div className={styles.sensorTooltip} role="tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.name}</div>}
    {errorMessage && <div className={styles.sensorStatus} role="status">{errorMessage}</div>}
  </div>;
}
