import React, { useState, useEffect, useRef } from 'react';
import { User, LogOut } from 'lucide-react';
import styles from './ProfileDropdown.module.css';
import supabase from '../helper/SupabaseClients';

import ProfileModal from './ProfileModal';
import ProfileAvatar from './ProfileAvatar';
import { fetchCurrentProfile } from './ProfileData.js';
import { PROFILE_UPDATED_EVENT } from './ProfilePhoto.js';
import { signOutAccount } from '../authentication/signOut.js';

const ProfileDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState({});
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const signOutPending = useRef(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!supabase) return;
      try {
        const result = await fetchCurrentProfile(supabase);
        if (active) setProfile(result.profile);
      } catch { if (active) setProfile({}); }
    };
    load();
    window.addEventListener(PROFILE_UPDATED_EVENT, load);
    const timer = window.setInterval(load, 45 * 60 * 1000);
    return () => { active = false; window.removeEventListener(PROFILE_UPDATED_EVENT, load); window.clearInterval(timer); };
  }, []);
  const dropdownRef = useRef(null);
  const [modalState, setModalState] = useState({ isOpen: false, mode: 'view' });

  // Close the dropdown if the user clicks outside of it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleAction = async (action) => {
    if (signOutPending.current) return;
    setIsOpen(false);

    if (action === 'Profile') {
      setModalState({ isOpen: true, mode: 'edit' });
    } else if (action === 'Log Out') {
      signOutPending.current = true;
      setSigningOut(true);
      setSignOutError('');
      try {
        const { remoteSignedOut } = await signOutAccount(supabase);
        window.location.replace(remoteSignedOut ? '/login' : '/login?signedOut=local');
      } catch {
        setSignOutError('We couldn’t confirm sign-out on this device. Please try again.');
        setIsOpen(true);
      } finally {
        signOutPending.current = false;
        setSigningOut(false);
      }
    }
  };

  return (
    <>
      <div className={styles.dropdownContainer} ref={dropdownRef}>
        <button type="button" onClick={() => setIsOpen(!isOpen)} className={styles.profileTrigger}
          aria-label="Profile menu" aria-expanded={isOpen} aria-controls={isOpen ? 'account-profile-menu' : undefined}>
          <ProfileAvatar profile={profile} className={styles.profileAvatar} fallback={<User size={20} />} />
        </button>

        {isOpen && (
          <div id="account-profile-menu" className={styles.dropdownMenu}>
            <div className={styles.menuHeader}>
              <span className={styles.userName}>Profile options</span>
            </div>
            <hr className={styles.divider} />
            <button onClick={() => handleAction('Profile')} className={styles.menuItem}>
              <User size={16} /> Profile &amp; security
            </button>
            <hr className={styles.divider} />
            {signOutError && <p className={styles.signOutError} role="alert">{signOutError}</p>}
            <button onClick={() => handleAction('Log Out')} className={`${styles.menuItem} ${styles.dangerItem}`} disabled={signingOut}>
              <LogOut size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </div>

      {/* 3. RENDER THE MODAL COMPONENT */}
      {modalState.isOpen && <ProfileModal
        isOpen={modalState.isOpen} 
        mode={modalState.mode} 
        onClose={() => setModalState({ isOpen: false, mode: 'view' })} 
      />}
    </>
  );
};

export default ProfileDropdown;
