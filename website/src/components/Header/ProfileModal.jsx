import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, MapPin, KeyRound, Eye, EyeOff, Camera, ShieldCheck, ChevronLeft } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './ProfileModal.module.css';
import MfaPage from '../authentication/MfaPage.jsx';
import { createProfileView, fetchCurrentProfile } from './ProfileData.js';
import ProfileAvatar from './ProfileAvatar';
import { PROFILE_PHOTO_ACCEPT, uploadProfilePhoto, removeProfilePhoto, notifyProfileUpdated } from './ProfilePhoto.js';

const normalizeRole = (role) => {
  const normalized = String(role || 'viewer').trim().toLowerCase();
  return normalized === 'user' ? 'viewer' : normalized;
};

const formatRoleLabel = (role) => {
  const normalized = normalizeRole(role);
  if (normalized === 'checkit_admin') return 'System Admin';
  if (normalized === 'checkit_field_operator') return 'System Field Operator';
  if (normalized === 'field_operator') return 'Institution Field Operator';
  if (normalized === 'admin') return 'Institution Admin';
  return 'Viewer';
};

const hasGlobalAccess = (role) => normalizeRole(role) === 'checkit_admin';

const ProfileModal = ({ isOpen, onClose, mode }) => {
  const [panel, setPanel] = useState(mode === 'password' ? 'password' : 'profile');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const photoInputRef = useRef(null);
  const [photoAction, setPhotoAction] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const photoSaving = Boolean(photoAction);
  const [passwordState, setPasswordState] = useState({
    password: '',
    confirmPassword: '',
    message: '',
    error: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [profile, setProfile] = useState(() => createProfileView());

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const fetchUserProfile = async () => {
      setLoading(true);
      try {
        const result = await fetchCurrentProfile(supabase);
        if (!active) return;
        setProfile(result.profile);
        setProfileError(result.error ? 'Some profile details couldn’t load. Reopen to retry.' : '');
      } catch (err) {
        if (!active) return;
        console.error("Error fetching profile:", err.message);
        setProfile(createProfileView());
        setProfileError('Couldn’t load your account. Please sign in again.');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchUserProfile();
    return () => { active = false; };
  }, [isOpen]);

  const handleClose = () => {
    if (!saving && !photoSaving && !mfaBusy) onClose();
  };

  const changePhoto = async (file) => {
    if (saving || photoSaving || !profile.id || profileError) return;
    setPhotoAction(file ? 'upload' : 'remove');
    setPhotoError('');
    setPhotoMessage('');
    try {
      const photo = file ? await uploadProfilePhoto(supabase, file) : await removeProfilePhoto(supabase);
      setProfile(current => ({ ...current, ...photo }));
      notifyProfileUpdated(photo);
      setPhotoMessage(file ? (photo.avatar_url ? 'Photo updated.' : 'Photo saved. Reopen your profile to retry the preview.') : 'Photo removed.');
    } catch (error) {
      const unavailable = /bucket|set_my_profile_photo|schema cache/i.test(error.message || '');
      setPhotoError(unavailable ? 'Photo uploads are not available yet. Please try again later.' : error.message || 'Your photo could not be saved. Please try again.');
    } finally {
      setPhotoAction('');
    }
  };

  const handleSave = async () => {
    if (profileError || photoSaving || saving) return;
    // STRICT GUARD: Prevent the empty UUID crash
    if (!profile.id) {
      alert("Authentication error: User ID is missing. Please refresh and log in again.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profile')
        .upsert({ 
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            // Note: We don't update assignments here; an admin should do that elsewhere
        });

      if (error) throw error;
      notifyProfileUpdated(profile);
      onClose(); 
    } catch (err) {
      alert("Failed to update profile: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSave = async () => {
    setPasswordState((current) => ({ ...current, message: '', error: '' }));

    if (passwordState.password.length < 8) {
      setPasswordState((current) => ({ ...current, error: 'Use at least 8 characters for your password.' }));
      return;
    }

    if (passwordState.password !== passwordState.confirmPassword) {
      setPasswordState((current) => ({ ...current, error: 'Passwords do not match.' }));
      return;
    }

    if (saving || photoSaving || !supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordState.password });
      if (error) throw error;
      setPasswordState({ password: '', confirmPassword: '', message: 'Password updated successfully.', error: '' });
    } catch (error) {
      setPasswordState(current => ({ ...current, error: error.message || 'Your password could not be updated. Please try again.' }));
    } finally {
      setSaving(false);
    }
  };

  // Helper function to determine the user's primary access level
  const renderAccessLevel = () => {
    if (hasGlobalAccess(profile.role)) return { level: 'Global Access', detail: 'All Transportation Areas & Systems' };
    if (normalizeRole(profile.role) === 'admin') return { level: 'Institution Admin Access', detail: 'Assigned Institution' };
    if (profile.assigned_room) return { level: 'Corridor Access', detail: 'Assigned corridor' };
    if (profile.assigned_floor) return { level: 'Corridor Access', detail: `Corridor ${profile.assigned_floor}` };
    if (profile.assigned_building) return { level: 'Area Access', detail: profile.building_name };
    if (profile.assigned_area) return { level: 'Institute Access', detail: profile.area_name };
    return { level: 'No Access Assigned', detail: 'Contact Administrator' };
  };

  if (!isOpen) return null;

  const access = renderAccessLevel();

  return createPortal(
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div className={styles.modalContent} role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" onClick={(e) => e.stopPropagation()}>
        
        <div className={styles.modalHeader}>
          <h2 id="profile-settings-title">Profile &amp; security</h2>
          <button className={styles.closeBtn} onClick={handleClose} disabled={saving || photoSaving || mfaBusy} aria-label="Close profile"><X size={20} /></button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading profile…</div>
        ) : (
          <div className={styles.modalBody}>
            {panel !== 'profile' && <button type="button" className={styles.backButton} disabled={saving || mfaBusy} onClick={() => { setPanel('profile'); setPasswordState({ password: '', confirmPassword: '', message: '', error: '' }); }}>
              <ChevronLeft size={16} aria-hidden="true" /> Back
            </button>}
            {panel === 'authenticator' ? <MfaPage embedded onVerified={onClose} onBusyChange={setMfaBusy} /> : panel === 'password' ? (
              <>
                <h3 className={styles.sectionTitle}>Change password</h3>
                {passwordState.error && <div className={styles.errorMessage}>{passwordState.error}</div>}
                {passwordState.message && <div className={styles.successMessage}>{passwordState.message}</div>}

                <label className={styles.label}>New password</label>
                <div className={styles.passwordField}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className={`${styles.input} ${styles.passwordInput}`}
                    value={passwordState.password}
                    onChange={(e) => setPasswordState({...passwordState, password: e.target.value})}
                    placeholder="Use at least 8 characters"
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                <label className={styles.label}>Confirm password</label>
                <div className={styles.passwordField}>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    className={`${styles.input} ${styles.passwordInput}`}
                    value={passwordState.confirmPassword}
                    onChange={(e) => setPasswordState({...passwordState, confirmPassword: e.target.value})}
                    placeholder="Re-enter your password"
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                <button className={styles.saveBtn} onClick={handlePasswordSave} disabled={saving}>
                  <KeyRound size={16} /> {saving ? 'Saving…' : 'Update password'}
                </button>
              </>
            ) : (
              <>
            {profileError && <div className={styles.errorMessage} role="status">{profileError}</div>}
            
            <section className={styles.photoSection} aria-label="Profile photo">
              <ProfileAvatar profile={profile} className={styles.photoPreview} />
              <div className={styles.photoContent}>
                <span className={styles.photoLabel}>Profile photo</span>
                {mode === 'edit' && <>
                  <input ref={photoInputRef} type="file" accept={PROFILE_PHOTO_ACCEPT} hidden
                    aria-label="Choose profile photo" disabled={saving || photoSaving || Boolean(profileError) || !profile.id}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) changePhoto(file);
                    }} />
                  <div className={styles.photoActions}>
                    <button className={styles.photoButton} type="button" onClick={() => photoInputRef.current?.click()}
                      disabled={saving || photoSaving || Boolean(profileError) || !profile.id}>
                      <Camera size={15} aria-hidden="true" />
                      {photoAction === 'upload' ? 'Uploading…' : profile.avatar_path ? 'Change photo' : 'Upload photo'}
                    </button>
                    {profile.avatar_path && <button className={styles.photoRemove} type="button" onClick={() => changePhoto(null)}
                      disabled={saving || photoSaving || Boolean(profileError)}>
                      {photoAction === 'remove' ? 'Removing…' : 'Remove'}
                    </button>}
                  </div>
                  <p className={styles.photoHint}>JPG, PNG, or WebP · Up to 5 MB. Photos save immediately.</p>
                </>}
              </div>
            </section>
            {photoError && <div className={styles.errorMessage} role="alert">{photoError}</div>}
            {photoMessage && <p className={styles.photoStatus} role="status">{photoMessage}</p>}

            {/* Access Level Display Area */}
            {!profileError && <div className={styles.accessBadge}>
                <MapPin size={16} />
                <div>
                    <strong>{access.level}</strong>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>{access.detail}</div>
                </div>
            </div>}

            <label className={styles.label}>Full name</label>
            <input 
              type="text" 
              className={styles.input} 
              value={profile.full_name}
              onChange={(e) => setProfile({...profile, full_name: e.target.value})}
              disabled={mode === 'view' || saving || photoSaving || Boolean(profileError)}
              placeholder="Enter your full name"
            />

            <label className={styles.label} htmlFor="profile-email">Email address</label>
            <input id="profile-email" type="email" className={styles.input} value={profile.email}
              readOnly placeholder="Email unavailable" title={profile.email} />

            <label className={styles.label}>Role</label>
            <input type="text" className={styles.input} value={profileError ? 'Unavailable' : formatRoleLabel(profile.role)} disabled />

            {mode === 'edit' && (
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving || photoSaving || Boolean(profileError) || !profile.id}>
                <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
            <section className={styles.securitySection} aria-labelledby="profile-security-title">
              <h3 id="profile-security-title" className={styles.sectionTitle}>Security</h3>
              <button type="button" className={styles.settingsButton} disabled={saving || photoSaving} onClick={() => setPanel('password')}>
                <KeyRound size={16} aria-hidden="true" /> Change password
              </button>
              <button type="button" className={styles.settingsButton} disabled={saving || photoSaving} onClick={() => setPanel('authenticator')}>
                <ShieldCheck size={16} aria-hidden="true" /> Authenticator
              </button>
            </section>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ProfileModal;
