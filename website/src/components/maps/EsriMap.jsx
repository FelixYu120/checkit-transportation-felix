import React, { useRef, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer";
import Search from "@arcgis/core/widgets/Search";
import Extent from "@arcgis/core/geometry/Extent";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import Query from "@arcgis/core/rest/support/Query";

import "@arcgis/core/assets/esri/themes/light/main.css";
import styles from "./EsriMap.module.css";
import supabase from "../helper/SupabaseClients";
import {
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  UCSD_MAP_CENTER,
  connectBuildingHoverHighlight,
  createBuildingSearchWidget,
  createBuildingsLayer,
  createNeighborhoodsLayer,
  createUcsdExtent,
  fetchBuildingAreaLookup,
  getBuildingHitResult,
  syncSelectedBuildingFeature,
  slugifyBuildingName,
} from "./MapShared";
import { getAdminCollegePath } from "../admin/routing/AdminRouteUtils";

const CampusMap = ({ embedded = false }) => {
  const mapDiv = useRef(null);
  const viewRef = useRef(null);
  const buildingsLayerRef = useRef(null);
  const highlightRef = useRef(null);
  const hoverHighlightRef = useRef(null);
  const hoveredObjectIdRef = useRef(null);
  const buildingAreaLookupRef = useRef({});
  const navigate = useNavigate();
  const location = useLocation();
  const { collegeId, buildingId } = useParams();

  useEffect(() => {
    if (!mapDiv.current) return;

    // UCSD rectangular boundary (Adjusted slightly to show neighbors)
    const UCSD_EXTENT = createUcsdExtent(Extent, SpatialReference);

    const neighborhoodsLayer = createNeighborhoodsLayer(GeoJSONLayer, {
      title: "Surrounding Neighborhoods",
      renderer: {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [0, 128, 255, 0.04], // Subtle blue tint
          outline: {
            color: [0, 128, 255, 0.2], // Soft blue borders
            width: 1
          }
        }
      }
    });

    const buildingsLayer = createBuildingsLayer(FeatureLayer);

    const map = new Map({
      basemap: "gray-vector",
      // Neighborhoods at index 0 (bottom), Buildings at index 1 (top)
      layers: [neighborhoodsLayer, buildingsLayer],
    });

    const view = new MapView({
      container: mapDiv.current,
      map,
      center: UCSD_MAP_CENTER,
      zoom: 15,
      ui: { components: [] }, 
      popup: { autoOpenEnabled: false },
    });
    viewRef.current = view;
    buildingsLayerRef.current = buildingsLayer;

    const initialize = async () => {
      await view.when();
      await buildingsLayer.load();

      try {
        buildingAreaLookupRef.current = await fetchBuildingAreaLookup(supabase);
      } catch (error) {
        console.error("Building area lookup error:", error);
        buildingAreaLookupRef.current = {};
      }

      // Constraints
      view.constraints = {
        geometry: UCSD_EXTENT,
        rotationEnabled: false,
        maxZoom: MAX_MAP_ZOOM,
        minZoom: MIN_MAP_ZOOM,
      };

      const searchWidget = createBuildingSearchWidget(Search, {
        view,
        buildingsLayer,
        outFields: ["building_id", "building_name"],
        placeholder: "Search buildings…",
      });

      view.ui.add(searchWidget, "top-left");
      view.ui.add("zoom", "bottom-left");

      const goToBuilding = (attributes) => {
        const buildingSlug = slugifyBuildingName(attributes?.building_name);
        if (buildingSlug) {
          const normalizedCollegeId =
            buildingAreaLookupRef.current[buildingSlug] ||
            collegeId ||
            "ucsd";
          navigate(getAdminCollegePath(normalizedCollegeId));
        }
      };

      searchWidget.on("select-result", (event) => {
        goToBuilding(event.result.feature.attributes);
      });

      view.on("click", async (event) => {
        const result = await getBuildingHitResult(view, event, buildingsLayer);
        if (result) {
          goToBuilding(result.graphic.attributes);
        }
      });

      await connectBuildingHoverHighlight({
        view,
        buildingsLayer,
        mapElement: mapDiv.current,
        hoverHighlightRef,
        hoveredObjectIdRef,
      });
    };

    initialize();

    return () => {
      hoverHighlightRef.current?.remove();
      hoverHighlightRef.current = null;
      hoveredObjectIdRef.current = null;
      highlightRef.current?.remove();
      highlightRef.current = null;
      buildingsLayerRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
  }, [navigate, collegeId]);

  useEffect(() => {
    syncSelectedBuildingFeature({
      Query,
      view: viewRef.current,
      buildingsLayer: buildingsLayerRef.current,
      buildingId,
      highlightRef,
    }).catch((error) => {
      console.error("Map selection sync error:", error);
    });
  }, [buildingId, location.pathname]);

  return (
    <div className={`${styles.mapWrapper} ${embedded ? styles.embedded : ""}`}>
      <div ref={mapDiv} className={styles.mapDiv}></div>
    </div>
  );
};

export default CampusMap;
