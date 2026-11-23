import styles from './Header.module.css'
import React from 'react'

function Header() {
    return (
        <header className={styles.headerBar}>  
            <a className={styles.brandLink} href="https://checkit.dev" aria-label="CheckIt home">
                <img src="/checkit-logo.png" alt="CheckIt" className={styles.checkitLogo} />
            </a>

        </header>
    );
}

export default Header;
