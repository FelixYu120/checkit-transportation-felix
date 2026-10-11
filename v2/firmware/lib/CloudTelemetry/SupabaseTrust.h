#pragma once

namespace CheckIt {

// Shared certificate bundle used by every firmware target that connects to a
// hosted Supabase HTTPS endpoint. Validation remains enabled.
const char *supabaseTrustAnchors();

}  // namespace CheckIt
