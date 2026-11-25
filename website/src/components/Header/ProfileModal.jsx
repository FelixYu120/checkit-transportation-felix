import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, MapPin, KeyRound, Eye, EyeOff, Camera, UserRound } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './ProfileModal.module.css';
import MfaPage from '../authentication/MfaPage.jsx';
import { createProfileView, fetchCurrentProfile } from './ProfileData.js';
import ProfileAvatar from './ProfileAvatar';
import ProfilePhotoEditor from './ProfilePhotoEditor';
import { PROFILE_PHOTO_ACCEPT, validateProfilePhoto, uploadProfilePhoto, removeProfilePhoto, notifyProfileUpdated } from './ProfilePhoto.js';

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
  const [saveError, setSaveError] = useState('');
  const originalName = useRef('');
  const photoInputRef = useRef(null);
  const [photoAction, setPhotoAction] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const [photoDraft, setPhotoDraft] = useState(null);
  const photoSaving = Boolean(photoAction);
  const [passwordState, setPasswordState] = useState({
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
        originalName.current = result.profile.full_name || '';
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

  const changePhoto = async (file, crop) => {
    if (saving || photoSaving || !profile.id || profileError) return;
    setPhotoAction(file ? 'upload' : 'remove');
    setPhotoError('');
    setPhotoMessage('');
    try {
      const photo = file ? await uploadProfilePhoto(supabase, file, { crop }) : await removeProfilePhoto(supabase);
      setProfile(current => ({ ...current, ...photo }));
      notifyProfileUpdated(photo);
      setPhotoDraft(null);
      setPhotoMessage(file ? (photo.avatar_url ? 'Photo updated.' : 'Photo saved. Reopen your profile to retry the preview.') : 'Photo removed.');
    } catch (error) {
      const unavailable = /bucket|set_my_profile_photo|schema cache/i.test(error.message || '');
      setPhotoError(unavailable ? 'Photo uploads are not available yet. Please try again later.' : error.message || 'Your photo could not be saved. Please try again.');
    } finally {
      setPhotoAction('');
    }
  };

  const handleSave = async () => {
    if (profileError || photoSaving || saving || photoDraft) return;
    setSaveError('');
    if (!profile.id) {
      setSaveError('Sign in again to update your profile.');
      return;
    }
    const fullName = profile.full_name.trim();
    if (!fullName) { setSaveError('Enter your full name.'); return; }
    if (fullName === originalName.current) { onClose(); return; }

    setSaving(true);
    try {
      const identity = await supabase.auth.getUser();
      if (identity.error || identity.data?.user?.id !== profile.id) throw new Error('Account changed.');
      const { data, error } = await supabase
        .from('profile')
        .update({ full_name: fullName })
        .eq('id', profile.id)
        .select('id,full_name')
        .single();

      if (error) throw error;
      if (data?.id !== profile.id || data.full_name !== fullName) throw new Error('Save not confirmed.');
      notifyProfileUpdated({ ...profile, full_name: fullName });
      onClose(); 
    } catch {
      setSaveError('Couldn’t save changes. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSave = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = form.elements.namedItem("checkit-transportation-profile-password")?.value || "";
    const confirmation = form.elements.namedItem("checkit-transportation-profile-confirm-password")?.value || "";
    setPasswordState((current) => ({ ...current, message: '', error: '' }));

    if (password.length < 8) {
      setPasswordState((current) => ({ ...current, error: 'Use at least 8 characters for your password.' }));
      return;
    }

    if (password !== confirmation) {
      setPasswordState((current) => ({ ...current, error: 'Passwords do not match.' }));
      return;
    }

    if (saving || photoSaving || !supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      form.reset();
      setShowPassword(false); setShowConfirmPassword(false);
      setPasswordState({ message: 'Password updated.', error: '' });
    } catch (error) {
      setPasswordState(current => ({ ...current, error: error.message || 'Your password could not be updated. Please try again.' }));
    } finally {
      setSaving(false);
    }
  };

  const changePanel = next => {
    if (saving || photoSaving || mfaBusy) return;
    setPanel(next);
    setPhotoDraft(null);
    setSaveError('');
    setPasswordState({ message: '', error: '' });
    setShowPassword(false);
    setShowConfirmPassword(false);
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
          <div className={styles.headerTitle}><span className={styles.headerMark}><UserRound size={20} aria-hidden="true" /></span><h2 id="profile-settings-title">Profile &amp; security</h2></div>
          <button className={styles.closeBtn} onClick={handleClose} disabled={saving || photoSaving || mfaBusy} aria-label="Close profile"><X size={20} /></button>
        </div>

        <nav className={styles.settingsNav} aria-label="Account settings">
          {[['profile','Profile'],['password','Password'],['authenticator','Two-step']].map(([key,label]) => <button key={key} type="button" aria-label={key==='authenticator'?'Two-step verification':label} aria-current={panel===key?'page':undefined} className={panel===key?styles.activePanel:undefined} disabled={saving || photoSaving || mfaBusy} onClick={()=>changePanel(key)}>{label}</button>)}
        </nav>
        {loading ? (
          <div className={styles.loading}>Loading profile…</div>
        ) : (
          <div className={styles.modalBody}>
            {panel === 'authenticator' ? <MfaPage embedded onVerified={onClose} onBusyChange={setMfaBusy} /> : panel === 'password' ? (
              <>
                <h3 className={styles.sectionTitle}>Change password</h3>
                <form className={styles.passwordForm} method="post" autoComplete="on" aria-label="Change Transportation password" onSubmit={handlePasswordSave}>
                <label className={styles.label} htmlFor="profile-password-email">Email address</label>
                <input id="profile-password-email" name="checkit-transportation-profile-username" className={styles.input} type="email" value={profile.email} readOnly autoComplete="section-checkit-transportation username" />
                {passwordState.error && <div className={styles.errorMessage} role="alert">{passwordState.error}</div>}
                {passwordState.message && <div className={styles.successMessage} role="status">{passwordState.message}</div>}

                <label className={styles.label} htmlFor="profile-new-password">New password</label>
                <div className={styles.passwordField}>
                  <input
                    id="profile-new-password" name="checkit-transportation-profile-password" autoComplete="section-checkit-transportation new-password" required minLength={8}
                    type={showPassword ? 'text' : 'password'}
                    className={`${styles.input} ${styles.passwordInput}`}
                    defaultValue=""
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

                <label className={styles.label} htmlFor="profile-confirm-password">Confirm password</label>
                <div className={styles.passwordField}>
                  <input
                    id="profile-confirm-password" name="checkit-transportation-profile-confirm-password" autoComplete="section-checkit-transportation new-password" required minLength={8}
                    type={showConfirmPassword ? 'text' : 'password'}
                    className={`${styles.input} ${styles.passwordInput}`}
                    defaultValue=""
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

                <button type="submit" className={styles.saveBtn} disabled={saving || !profile.id}>
                  <KeyRound size={16} /> {saving ? 'Saving…' : 'Update password'}
                </button>
                </form>
              </>
            ) : (
              <>
            {profileError && <div className={styles.errorMessage} role="status">{profileError}</div>}
            {saveError && <div className={styles.errorMessage} role="alert">{saveError}</div>}
            
            <section className={styles.photoSection} aria-label="Profile photo">
              <ProfileAvatar profile={profile} className={styles.photoPreview} />
              <div className={styles.photoContent}>
                <span className={styles.photoLabel}>Profile photo</span>
                {mode === 'edit' && <>
                  <input ref={photoInputRef} type="file" accept={PROFILE_PHOTO_ACCEPT} hidden
                    aria-label="Choose profile photo" disabled={saving || photoSaving || Boolean(photoDraft) || Boolean(profileError) || !profile.id}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      setPhotoError(''); setPhotoMessage('');
                      try { validateProfilePhoto(file); setPhotoDraft(file); }
                      catch (error) { setPhotoError(error.message); }
                    }} />
                  <div className={styles.photoActions}>
                    <button className={styles.photoButton} type="button" onClick={() => photoInputRef.current?.click()}
                      disabled={saving || photoSaving || Boolean(photoDraft) || Boolean(profileError) || !profile.id}>
                      <Camera size={15} aria-hidden="true" />
                      {photoAction === 'upload' ? 'Uploading…' : profile.avatar_path ? 'Change photo' : 'Upload photo'}
                    </button>
                    {profile.avatar_path && <button className={styles.photoRemove} type="button" onClick={() => changePhoto(null)}
                      disabled={saving || photoSaving || Boolean(photoDraft) || Boolean(profileError)}>
                      {photoAction === 'remove' ? 'Removing…' : 'Remove'}
                    </button>}
                  </div>
                  <p className={styles.photoHint}>JPG, PNG, or WebP · Up to 5 MB.</p>
                </>}
              </div>
            </section>
            {photoDraft && <ProfilePhotoEditor file={photoDraft} busy={photoSaving}
              onSave={crop => changePhoto(photoDraft, crop)} onCancel={() => { setPhotoDraft(null); setPhotoError(''); }} />}
            {photoError && <div className={styles.errorMessage} role="alert">{photoError}</div>}
            {photoMessage && <p className={styles.photoStatus} role="status">{photoMessage}</p>}

            <label className={styles.label} htmlFor="profile-full-name">Full name</label>
            <input 
              id="profile-full-name" type="text"
              className={styles.input} 
              value={profile.full_name}
              onChange={(e) => setProfile({...profile, full_name: e.target.value})}
              disabled={mode === 'view' || saving || photoSaving || Boolean(profileError)}
              placeholder="Enter your full name"
            />

            <label className={styles.label} htmlFor="profile-email">Email address</label>
            <input id="profile-email" type="email" className={styles.input} value={profile.email}
              readOnly placeholder="Email unavailable" title={profile.email} />

            <label className={styles.label} htmlFor="profile-role">Role</label>
            <input id="profile-role" type="text" className={styles.input} value={profileError ? 'Unavailable' : formatRoleLabel(profile.role)} disabled />

            {/* Access Level Display Area */}
            {!profileError && <div className={styles.accessBadge}>
                <MapPin size={16} />
                <div>
                    <strong>{access.level}</strong>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>{access.detail}</div>
                </div>
            </div>}

            {mode === 'edit' && (
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving || photoSaving || Boolean(photoDraft) || Boolean(profileError) || !profile.id}>
                <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}

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
