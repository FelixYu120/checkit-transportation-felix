
// This is the default page when logged in for now, we should have a default landing page
// at some point 
export const DEFAULT_ADMIN_ROUTE =
  "/dashboard/institute/ucsd";

export const slugifyAdminPathSegment = (text) => {
  if (!text) return "unknown";
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
};

export const getFloorRouteSegment = (floorId) => {
  const value = String(floorId || "").trim();
  if (!value) return "corridors";
  const normalizedValue = value.toLowerCase();
  if (normalizedValue.startsWith("corridors/")) return normalizedValue;
  if (normalizedValue.startsWith("corridors")) {
    return `corridors/${value.replace(/^corridors/i, "")}`;
  }
  if (normalizedValue.startsWith("floor")) {
    return `corridors/${value.replace(/^floor/i, "")}`;
  }
  return `corridors/${value}`;
};

export const getFloorNumberFromRouteSegment = (floorSegment) =>
  String(floorSegment || "")
    .replace(/^corridors/i, "")
    .replace(/^floor/i, "");

export const formatAdminRouteLabel = (value) =>
  (value || "")
    .split(/[-_]/)
    .map((word) => {
      if (word.toLowerCase() === "and") return "&";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");

export const getAdminCollegePath = (collegeId) =>
  `/dashboard/institute/${collegeId}`;

export const getAdminBuildingPath = (collegeId) =>
  getAdminCollegePath(collegeId);

export const getAdminAreaPath = (collegeId, areaId) =>
  `${getAdminCollegePath(collegeId)}/area/${areaId}`;

export const getAdminFloorPath = (collegeId, buildingOrFloorId, maybeFloorId) => {
  const floorId = maybeFloorId ?? buildingOrFloorId;
  return `${getAdminCollegePath(collegeId)}/${getFloorRouteSegment(floorId)}`;
};
