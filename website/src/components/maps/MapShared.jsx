export const BUILDINGS_LAYER_URL =
  "https://services1.arcgis.com/eGSDp8lpKe5izqVc/arcgis/rest/services/UCSD_Campus_Buildings/FeatureServer/0";

export const NEIGHBORHOODS_GEOJSON_URL = "/bndUCSDNeighbo_FeaturesToJSO.json";

export const UCSD_MAP_CENTER = [-117.2415, 32.8905];

export const UCSD_EXTENT_CONFIG = {
  xmin: -117.260,
  ymin: 32.860,
  xmax: -117.210,
  ymax: 32.900,
};

export const MIN_MAP_ZOOM = 15;
export const MAX_MAP_ZOOM = 20;

export const createUcsdExtent = (Extent, SpatialReference) =>
  new Extent({
    ...UCSD_EXTENT_CONFIG,
    spatialReference: SpatialReference.WGS84,
  });

export const createNeighborhoodsLayer = (GeoJSONLayer, options = {}) =>
  new GeoJSONLayer({
    url: NEIGHBORHOODS_GEOJSON_URL,
    ...options,
  });

export const createBuildingsLayer = (FeatureLayer, options = {}) =>
  new FeatureLayer({
    url: BUILDINGS_LAYER_URL,
    outFields: ["*"],
    popupEnabled: false,
    ...options,
  });

export const fetchBuildingAreaLookup = async () => ({});

export const createBuildingSearchWidget = (
  Search,
  { view, buildingsLayer, outFields, placeholder, exactMatch }
) =>
  new Search({
    view,
    includeDefaultSources: false,
    locationEnabled: false,
    popupEnabled: false,
    sources: [
      {
        layer: buildingsLayer,
        searchFields: ["building_name"],
        displayField: "building_name",
        outFields,
        placeholder,
        ...(exactMatch === undefined ? {} : { exactMatch }),
      },
    ],
  });

export const getBuildingHitResult = async (view, event, buildingsLayer) => {
  const response = await view.hitTest(event);
  return response.results.find(
    (result) => result.graphic && result.graphic.layer === buildingsLayer
  );
};

export const connectBuildingHoverHighlight = async ({
  view,
  buildingsLayer,
  mapElement,
  hoverHighlightRef,
  hoveredObjectIdRef,
}) => {
  const buildingsLayerView = await view.whenLayerView(buildingsLayer);

  return view.on("pointer-move", async (event) => {
    const buildingResult = await getBuildingHitResult(view, event, buildingsLayer);
    const hoveredGraphic = buildingResult?.graphic;
    const hoveredObjectId = hoveredGraphic?.getObjectId?.() ?? null;

    if (mapElement) {
      mapElement.style.cursor = hoveredGraphic ? "pointer" : "default";
    }

    if (!hoveredGraphic) {
      hoverHighlightRef.current?.remove();
      hoverHighlightRef.current = null;
      hoveredObjectIdRef.current = null;
      return;
    }

    if (hoveredObjectIdRef.current === hoveredObjectId) {
      return;
    }

    hoverHighlightRef.current?.remove();
    hoverHighlightRef.current = buildingsLayerView.highlight(hoveredGraphic);
    hoveredObjectIdRef.current = hoveredObjectId;
  });
};

export const clearHighlight = (highlightRef) => {
  highlightRef.current?.remove();
  highlightRef.current = null;
};

export const normalizeBuildingId = (value) =>
  String(value || "").toLowerCase().trim();

export const findBuildingFeatureByRouteId = async ({
  Query,
  buildingsLayer,
  buildingId,
}) => {
  const normalizedRouteBuildingId = normalizeBuildingId(buildingId);

  const query = new Query({
    where: "1=1",
    returnGeometry: true,
    outFields: ["building_id", "building_name"],
  });

  const featureSet = await buildingsLayer.queryFeatures(query);
  return featureSet.features?.find((candidate) => {
    const attributes = candidate.attributes || {};
    return (
      slugifyBuildingName(attributes.building_name) === normalizedRouteBuildingId ||
      normalizeBuildingId(attributes.building_id) === normalizedRouteBuildingId
    );
  });
};

export const syncSelectedBuildingFeature = async ({
  Query,
  view,
  buildingsLayer,
  buildingId,
  highlightRef,
}) => {
  if (!view || !buildingsLayer || !buildingId) {
    clearHighlight(highlightRef);
    return;
  }

  await view.when();
  await buildingsLayer.load();

  const feature = await findBuildingFeatureByRouteId({
    Query,
    buildingsLayer,
    buildingId,
  });

  clearHighlight(highlightRef);

  if (!feature) return;

  const layerView = await view.whenLayerView(buildingsLayer);
  highlightRef.current = layerView.highlight(feature);

  if (feature.geometry?.extent) {
    view.goTo(feature.geometry.extent.expand(2), {
      duration: 800,
    }).catch(() => {});
  }
};

export const slugifyBuildingName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
