import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, ShieldAlert, MapPin, KeyRound, Eye, EyeOff } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './ProfileModal.module.css';
import { createProfileView, fetchCurrentProfile } from './ProfileData.js';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
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

  const handleSave = async () => {
    if (profileError) return;
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

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: passwordState.password });

    if (error) {
      setPasswordState((current) => ({ ...current, error: error.message }));
    } else {
      setPasswordState({
        password: '',
        confirmPassword: '',
        message: 'Password updated successfully.',
        error: ''
      });
    }

    setSaving(false);
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
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        
        <div className={styles.modalHeader}>
          <h2>{mode === 'password' ? 'Change Password' : 'Profile'}</h2>
          <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading profile data...</div>
        ) : (
          <div className={styles.modalBody}>
            {mode === 'password' ? (
              <>
                {passwordState.error && <div className={styles.errorMessage}>{passwordState.error}</div>}
                {passwordState.message && <div className={styles.successMessage}>{passwordState.message}</div>}

                <label className={styles.label}>New Password</label>
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

                <label className={styles.label}>Confirm Password</label>
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
                  <KeyRound size={16} /> {saving ? 'Saving...' : 'Update Password'}
                </button>
              </>
            ) : (
              <>
            {profileError && <div className={styles.errorMessage} role="status">{profileError}</div>}
            
            {!profileError && hasGlobalAccess(profile.role) && (
               <div className={styles.adminBadge}>
                 <ShieldAlert size={16} /> System Admin Override Active
               </div>
            )}

            {/* Access Level Display Area */}
            {!profileError && <div className={styles.accessBadge}>
                <MapPin size={16} />
                <div>
                    <strong>{access.level}</strong>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>{access.detail}</div>
                </div>
            </div>}

            <label className={styles.label}>Full Name</label>
            <input 
              type="text" 
              className={styles.input} 
              value={profile.full_name}
              onChange={(e) => setProfile({...profile, full_name: e.target.value})}
              disabled={mode === 'view' || Boolean(profileError)}
              placeholder="Enter your full name"
            />

            <label className={styles.label} htmlFor="profile-email">Email Address</label>
            <input id="profile-email" type="email" className={styles.input} value={profile.email}
              readOnly placeholder="Email unavailable" title={profile.email} />

            <label className={styles.label}>Role</label>
            <input type="text" className={styles.input} value={profileError ? 'Unavailable' : formatRoleLabel(profile.role)} disabled />

            {mode === 'edit' && (
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving || Boolean(profileError) || !profile.id}>
                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
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
