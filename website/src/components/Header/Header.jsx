import styles from './Header.module.css'
import React from 'react'

function Header() {
    return (
        <header className={styles.headerBar}>  
            <a href="https://checkit.dev">
                <img src="/checkit-logo.png" alt="logo" className={styles.checkitLogo} />
            </a>

        </header>
    );
}

export default Header;
