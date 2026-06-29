import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react'; 
import styles from './PromiSidebar.module.css';

const PromiSidebar = ({ floorId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
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
    if (!inputText.trim()) return;

    const userMessage = { role: 'user', content: inputText };
    const contextHistory = [
      { 
        role: 'system', 
        content: `You are an assistant for Checkit. The user is currently viewing ${floorId ? `Corridor ${floorId}` : 'the transportation network'}. Do not mention sensor IDs. Only discuss corridor-level transportation data.` 
      },
      ...chatHistory,
      userMessage
    ];

    setChatHistory([...chatHistory, userMessage]);
    setInputText('');
    setLoading(true);

    try {
        const baseUrl = 'https://checkit-api.vercel.app';
        
        const promiRes = await fetch(`${baseUrl}/api/promi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chatHistory: contextHistory,
                floorId
            })
        });
        

        const promiData = await promiRes.json();
        if (promiData.reply) {
            setChatHistory(prev => [...prev, { role: 'assistant', content: promiData.reply }]);
        }
    } catch (error) {
        console.error("Promi Error:", error);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className={`${styles.sidebarWrapper} ${isOpen ? styles.open : styles.closed}`}>
      
      <button className={styles.pullButton} onClick={toggleSidebar}>
        {isOpen ? <ChevronRight size={24} /> : <ChevronLeft size={24} />}
      </button>

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
