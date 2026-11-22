import supabase from '../../helper/SupabaseClients';
import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react'; 
import styles from './PromiSidebar.module.css';


const PromiSidebar = ({ floorId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => {
      requestVersion.current += 1;
      setChatHistory([{role:'assistant',content:'Hello, I am Promi! What would you like to know?'}]);
      setInputText('');
      setLoading(false);
      setErrorMessage('');
    });
    return () => { requestVersion.current += 1; data.subscription.unsubscribe(); };
  }, []);
  const chatEndRef = useRef(null);

  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', content: `Hello, I am Promi!\n What would you like to know?` }
  ]);

  const toggleSidebar = () => setIsOpen(!isOpen);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, loading]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;
    const version = ++requestVersion.current;
    setErrorMessage('');

    const userMessage = { role: 'user', content: inputText };
    const contextHistory = [...chatHistory, userMessage].slice(-50);

    setChatHistory([...chatHistory, userMessage]);
    setInputText('');
    setLoading(true);

    try {
        const baseUrl = 'https://checkit-api.vercel.app';
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) throw new Error('Sign in again to use Promi.');
        
        const promiRes = await fetch(`${baseUrl}/api/promi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(55000),
            body: JSON.stringify({ 
                chatHistory: contextHistory,
                floorId
            })
        });
        

        const promiData = await promiRes.json();
        if (!promiRes.ok) throw new Error(promiData.error || 'Promi is temporarily unavailable.');
        if (version === requestVersion.current && promiData.reply) {
            setChatHistory(prev => [...prev, { role: 'assistant', content: promiData.reply }]);
        }
    } catch (error) {
        if (version === requestVersion.current) setErrorMessage(error.message || 'Promi is temporarily unavailable.');
    } finally {
        if (version === requestVersion.current) setLoading(false);
    }
  };

  return (
    <div className={`${styles.sidebarWrapper} ${isOpen ? styles.open : styles.closed}`}>
      
      <button className={styles.pullButton} onClick={toggleSidebar}>
        {isOpen ? <ChevronRight size={24} /> : <ChevronLeft size={24} />}
      </button>

      {errorMessage && <p role="alert">{errorMessage}</p>}
      <div className={styles.header}>Promi Assistant</div>

      <div className={styles.chatContainer}>
        {chatHistory.map((msg, index) => (
          <div key={index} className={`${styles.messageRow} ${msg.role === 'user' ? styles.userRow : styles.aiRow}`}>
            <div className={`${styles.bubble} ${msg.role === 'user' ? styles.userBubble : styles.aiBubble}`}>
              {msg.role === 'assistant' 
                ? msg.content.split('\n').map((line, i) => line.trim() !== '' && <p key={i}>{line}</p>)
                : msg.content
              }
            </div>
          </div>
        ))}
        {loading && (
          <div className={`${styles.messageRow} ${styles.aiRow}`}>
            <div className={styles.loadingBubble}>Promi is analyzing {floorId ? `Corridor ${floorId}` : 'the transportation network'}...</div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <form className={styles.inputArea} onSubmit={handleSendMessage}>
        <input 
          type="text" 
          className={styles.chatInput}
          placeholder="Ask about this corridor..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className={styles.sendButton} disabled={loading || !inputText.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
};

export default PromiSidebar;
