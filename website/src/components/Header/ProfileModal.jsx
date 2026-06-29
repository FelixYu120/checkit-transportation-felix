import React, { useState, useEffect } from 'react';
import { X, Save, ShieldAlert, MapPin, KeyRound } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './ProfileModal.module.css';

const ProfileModal = ({ isOpen, onClose, mode }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordState, setPasswordState] = useState({
    password: '',
    confirmPassword: '',
    message: '',
    error: ''
  });
  
  const [profile, setProfile] = useState({
    id: '',
    full_name: '',
    email: '',
    role: 'user',
    last_logged_in: '',
    assigned_area: null,
    assigned_building: null,
    assigned_floor: null,
    assigned_room: null,
    // Joined data for display purposes
    area_name: 'None',
    building_name: 'None'
  });

  useEffect(() => {
    if (!isOpen) return;

    const fetchUserProfile = async () => {
      setLoading(true);
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;

        if (user) {
          // Fetch the profile AND join the related location names in one query
          const { data, error } = await supabase
            .from('profile')
            .select(`
              *,
              areas!profile_assigned_area_fkey(name),
              buildings!profile_assigned_building_fkey(name)
            `)
            .eq('id', user.id)
            .maybeSingle();

          if (error) throw error;
          
          setProfile({
            id: user.id, // Strictly pulled from secure auth context
            full_name: data?.full_name || '',
            email: user.email,
            role: data?.role || 'user',
            last_logged_in: data?.last_logged_in || new Date().toISOString(),
            assigned_area: data?.assigned_area || null,
            assigned_building: data?.assigned_building || null,
            assigned_floor: data?.assigned_floor || null,
            assigned_room: data?.assigned_room || null,
            area_name: data?.areas?.name || 'None',
            building_name: data?.buildings?.name || 'None'
          });
        }
      } catch (err) {
        console.error("Error fetching profile:", err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [isOpen]);

  const handleSave = async () => {
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
            role: profile.role,
            last_logged_in: profile.last_logged_in
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
    if (profile.role === 'admin') return { level: 'Global Access', detail: 'All Transportation Areas & Systems' };
    if (profile.assigned_room) return { level: 'Corridor Access', detail: 'Assigned corridor' };
    if (profile.assigned_floor) return { level: 'Corridor Access', detail: `Corridor ${profile.assigned_floor}` };
    if (profile.assigned_building) return { level: 'Area Access', detail: profile.building_name };
    if (profile.assigned_area) return { level: 'Institute Access', detail: profile.area_name };
    return { level: 'No Access Assigned', detail: 'Contact Administrator' };
  };

  if (!isOpen) return null;

  const access = renderAccessLevel();

  return (
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
                <input
                  type="password"
                  className={styles.input}
                  value={passwordState.password}
                  onChange={(e) => setPasswordState({...passwordState, password: e.target.value})}
                  placeholder="Use at least 8 characters"
                />

                <label className={styles.label}>Confirm Password</label>
                <input
                  type="password"
                  className={styles.input}
                  value={passwordState.confirmPassword}
                  onChange={(e) => setPasswordState({...passwordState, confirmPassword: e.target.value})}
                  placeholder="Re-enter your password"
                />

                <button className={styles.saveBtn} onClick={handlePasswordSave} disabled={saving}>
                  <KeyRound size={16} /> {saving ? 'Saving...' : 'Update Password'}
                </button>
              </>
            ) : (
              <>
            
            {profile.role === 'admin' && (
               <div className={styles.adminBadge}>
                 <ShieldAlert size={16} /> Admin Override Active
               </div>
            )}

            {/* Access Level Display Area */}
            <div className={styles.accessBadge}>
                <MapPin size={16} />
                <div>
                    <strong>{access.level}</strong>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>{access.detail}</div>
                </div>
            </div>

            <label className={styles.label}>Full Name</label>
            <input 
              type="text" 
              className={styles.input} 
              value={profile.full_name}
              onChange={(e) => setProfile({...profile, full_name: e.target.value})}
              disabled={mode === 'view'}
              placeholder="Enter your full name"
            />

            <label className={styles.label}>Email Address (Read Only)</label>
            <input type="text" className={styles.input} value={profile.email} disabled />

            <div className={styles.loginTracker}>
              <strong>Last Logged In:</strong> {new Date(profile.last_logged_in).toLocaleString()}
            </div>

            {mode === 'edit' && (
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileModal;
