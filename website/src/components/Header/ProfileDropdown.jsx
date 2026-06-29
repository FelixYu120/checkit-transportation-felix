import React, { useState, useEffect, useRef } from 'react';
import { KeyRound, User, LogOut } from 'lucide-react';
import styles from './ProfileDropdown.module.css';
import supabase from '../helper/SupabaseClients';

import ProfileModal from './ProfileModal';

const ProfileDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
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
    setIsOpen(false);

    if (action === 'Profile') {
      setModalState({ isOpen: true, mode: 'edit' });
    } else if (action === 'Change Password') {
      setModalState({ isOpen: true, mode: 'password' });
    } else if (action === 'Log Out') {
      await supabase.auth.signOut();
      window.location.href = '/';
    }
  };

  return (
    <>
      <div className={styles.dropdownContainer} ref={dropdownRef}>
        <button onClick={() => setIsOpen(!isOpen)} className={styles.profileTrigger}>
          <User size={20} />
        </button>

        {isOpen && (
          <div className={styles.dropdownMenu}>
            <div className={styles.menuHeader}>
              <span className={styles.userName}>Profile Options</span>
            </div>
            <hr className={styles.divider} />
            <button onClick={() => handleAction('Profile')} className={styles.menuItem}>
              <User size={16} /> Profile
            </button>
            <button onClick={() => handleAction('Change Password')} className={styles.menuItem}>
              <KeyRound size={16} /> Change Password
            </button>
            <hr className={styles.divider} />
            <button onClick={() => handleAction('Log Out')} className={`${styles.menuItem} ${styles.dangerItem}`}>
              <LogOut size={16} /> Log Out
            </button>
          </div>
        )}
      </div>

      {/* 3. RENDER THE MODAL COMPONENT */}
      <ProfileModal 
        isOpen={modalState.isOpen} 
        mode={modalState.mode} 
        onClose={() => setModalState({ isOpen: false, mode: 'view' })} 
      />
    </>
  );
};

export default ProfileDropdown;
