import styles from './Header.module.css'
import React from 'react'

function Header() {
    return (
        <header className={styles.headerBar}>  
            <a href="https://checkit.dev">
                <img src="/checkit-logo-enterprise.svg" alt="CheckIt" className={styles.checkitLogo} />
            </a>

        </header>
    );
}

export default Header;
