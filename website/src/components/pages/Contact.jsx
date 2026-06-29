import React, { useState } from 'react';
import styles from './Contact.module.css';

function Contact() {
    const [formData, setFormData] = useState({ 
        subject: '', 
        message: '' 
    });
    const handleChange = (e) => {
        setFormData({ 
            ...formData, 
            [e.target.name]: e.target.value 
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        const email = "check.it.team0828@gmail.com";
        const subject = encodeURIComponent(formData.subject);
        const body = encodeURIComponent(formData.message);

        // This is the "Magic Link" that triggers the user's local email app
        const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;
        
        // Redirect the browser to the mailto link
        window.location.href = mailtoUrl;

        // Optional: Reset form after sending
        setFormData({ subject: '', message: '' });
    };

    return (
        <div className={styles.pageContainer}>
            {/* Headers */}
            <h1 className={styles.heading}>Contact Us</h1>
            <h3 className={styles.subHeading}>Have any questions or suggestions?</h3>

            {/* Form Section */}
            <form onSubmit={handleSubmit} className={styles.formContainer}>
                
                <input 
                    name="subject"
                    type="text" 
                    placeholder="Subject" 
                    className={styles.inputField}
                    value={formData.subject}
                    onChange={handleChange}
                    required 
                />

                <textarea 
                    name="message"
                    placeholder="What’s on your mind?" 
                    className={styles.textArea}
                    value={formData.message}
                    onChange={handleChange}
                    required 
                />

                <button type="submit" className={styles.submitButton}>
                    Open Email App
                </button>
            </form>

            {/* Separator */}
            <div className={styles.separator}>OR</div>

            {/* Email Footer */}
            <p className={styles.emailText}>
                Email us directly at: <a href="mailto:check.it.team0828@gmail.com" className={styles.emailLink}>
                    check.it.team@gmail.com
                </a>
            </p>
        </div>
    );
}

export default Contact;