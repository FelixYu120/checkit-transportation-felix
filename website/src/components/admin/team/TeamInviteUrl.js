const DEFAULT_TEAM_API_URL = "https://checkit-transportation-felix.vercel.app";

export const resolveTeamInviteUrl = (configuredUrl = "") => {
  let url;
  try {
    url = new URL(String(configuredUrl || "").trim() || DEFAULT_TEAM_API_URL);
  } catch {
    throw new Error("The invitation service address is invalid. Contact your administrator.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("The invitation service address must use HTTP or HTTPS.");
  }
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api/team/invite")
    ? path
    : `${path.replace(/\/api$/, "")}/api/team/invite`;
  return url.toString();
};
