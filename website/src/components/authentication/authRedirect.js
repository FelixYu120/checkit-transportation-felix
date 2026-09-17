export const getSupabaseAuthRedirectPath = ({ pathname = "", search = "", hash = "" } = {}) => {
  const hashParams = new URLSearchParams(String(hash).replace(/^#/, ""));
  const searchParams = new URLSearchParams(search);
  const authType = hashParams.get("type") || searchParams.get("type");
  const hasAuthCode = searchParams.has("code");
  const hasAuthToken = hashParams.has("access_token") || hashParams.has("refresh_token");
  const isPasswordPath = pathname === "/set-password" || pathname === "/forgot-password";

  if (authType === "invite") return "/create-account";
  if (authType === "recovery") return "/set-password";
  if ((hasAuthCode || hasAuthToken) && !isPasswordPath) return "/create-account";

  return null;
};

