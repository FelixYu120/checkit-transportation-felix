# Profile photos

Status: `20261124030000_profile_photos.sql` applied and recorded on both hosted Supabase projects on November 24, 2026. Felix handles frontend publication.

The migration adds `profile.avatar_path`, a private `profile-photos` bucket, storage policies, and the authenticated `set_my_profile_photo` RPC. It depends on the invitation and authenticator migrations. No service key belongs in the frontend. The live database work is complete; do not reapply this migration manually or apply unrelated pending migrations.

Members can upload, replace, or remove their own picture in **Profile & security → Profile** or choose **Edit profile** from their own team card. Photo changes save immediately, independently of the full-name Save button. The app accepts JPG, PNG, or WebP up to 5 MB, crops the center to a square, and re-encodes a 512-pixel WebP. Original filenames and image metadata are not stored. Upload objects have unique names so replacing a photo does not reuse a cached URL.

Only the owner can upload/delete their objects. Active members who completed password login and any required MFA can view current profile photos across institutions through temporary signed URLs. Anonymous, invitation-only, revoked, and MFA-blocked sessions cannot request photo links or change pictures. Owners can also access their own unselected uploads for cleanup; other users can access only the photo currently selected on a profile. This visibility does not grant access to another institution's directory, email addresses, roles, or operational data. Previously issued links expire after one hour. The UI refreshes links every 45 minutes while open, and falls back to initials if an image cannot load. Profile role, email, and institution assignments are not changed by the photo RPC.

The team directory remains usable before migration and during storage outages. New image files are not deleted after an ambiguous save failure until a profile read confirms they are unused. Successful replacements/removals attempt to clean up the old owned object. Cleanup errors do not undo a saved profile; unreferenced private objects may be removed later through the Storage API.

For local SQL verification, use the isolated database fixture in `supabase/tests/profile_photos.sql`. No test should connect to a hosted database.

After Felix publishes, upload a photo from your own team card, check that it appears in Profile and the directory, then verify it from a second member's account. Replace and remove it, and check that an unsupported file or an image over 5 MB shows an error without changing the existing picture. Opening another member's details must not offer photo editing.
