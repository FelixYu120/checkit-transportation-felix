import React, { useRef, useEffect } from "react";

import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer";
import Search from "@arcgis/core/widgets/Search";
import Extent from "@arcgis/core/geometry/Extent";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";

import "@arcgis/core/assets/esri/themes/light/main.css";
import styles from "./MapPage.module.css";
import {
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  UCSD_MAP_CENTER,
  connectBuildingHoverHighlight,
  createBuildingSearchWidget,
  createBuildingsLayer,
  createNeighborhoodsLayer,
  createUcsdExtent,
  getBuildingHitResult,
} from "./MapShared";

const MapPage = ({ onBuildingClick }) => {
  const mapDiv = useRef(null);
  const viewRef = useRef(null);
  const hoverHighlightRef = useRef(null);
  const hoveredObjectIdRef = useRef(null);
  const hasInitialized = useRef(false); 
  useEffect(() => {
    if (!mapDiv.current || hasInitialized.current) return;
    hasInitialized.current = true;

    const UCSD_EXTENT = createUcsdExtent(Extent, SpatialReference);

    const neighborhoodsLayer = createNeighborhoodsLayer(GeoJSONLayer, {
      renderer: {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [150, 150, 150, 0.03], // Neutral gray
          outline: {
            color: [150, 150, 150, 0.3],
            width: 0.8
          }
        }
      }
    });

    const buildingsLayer = createBuildingsLayer(FeatureLayer, {
      title: "BuildingsLayer"
    });

    const map = new Map({
      basemap: "gray-vector",
      layers: [neighborhoodsLayer, buildingsLayer],
    });

    const view = new MapView({
      container: mapDiv.current,
      map,
      center: UCSD_MAP_CENTER,
      zoom: 16,
      constraints: {
        geometry: UCSD_EXTENT,
        minZoom: MIN_MAP_ZOOM,
        maxZoom: MAX_MAP_ZOOM,
        rotationEnabled: false
      },
      popupEnabled: false,
      ui: { components: [] } 
    });

    view.when(() => {
      view.ui.add("zoom", "bottom-left");

      const searchWidget = createBuildingSearchWidget(Search, {
        view,
        buildingsLayer,
        exactMatch: false,
        outFields: ["*"],
        placeholder: "Find a building...",
      });

      searchWidget.on("select-result", (event) => {
        const bId = event.result.feature.attributes.building_id;
        if (onBuildingClick) onBuildingClick(String(bId).toLowerCase().trim());
      });

      view.ui.add(searchWidget, "top-left");

      view.on("click", async (event) => {
        const result = await getBuildingHitResult(view, event, buildingsLayer);
        if (result) {
          const bId = result.graphic.attributes.building_id;
          if (onBuildingClick) onBuildingClick(String(bId).toLowerCase().trim());
        }
      });

      connectBuildingHoverHighlight({
        view,
        buildingsLayer,
        mapElement: mapDiv.current,
        hoverHighlightRef,
        hoveredObjectIdRef,
      }).catch((error) => {
        console.error("Map hover setup error:", error);
      });
      
      viewRef.current = view;
    });

    return () => {
        hoverHighlightRef.current?.remove();
        hoverHighlightRef.current = null;
        hoveredObjectIdRef.current = null;
        if (viewRef.current) {
            viewRef.current.destroy();
            hasInitialized.current = false;
        }
    };
  }, [onBuildingClick]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={mapDiv} className={styles.mapDiv} style={{ height: "100%", width: "100%" }}></div>
    </div>
  );
};

export default MapPage;
