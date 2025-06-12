import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

const socket = io('https://chatify-backend-sh82.onrender.com');

function App() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [username, setUsername] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [contactPhone, setContactPhone] = useState('');
  const [groupId, setGroupId] = useState('');
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [typing, setTyping] = useState({});
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    socket.on('message', (newMessage) => {
      setMessages(prev => [...prev, newMessage]);
      if (document.hidden && newMessage.senderPhone !== phoneNumber) {
        alert(`New message from ${newMessage.senderPhone || 'Group'}: ${newMessage.message || 'File'}`);
      }
    });
    socket.on('messageStatus', ({ messageId, status }) => {
      setMessages(prev =>
        prev.map(msg => msg._id === messageId ? { ...msg, status } : msg)
      );
    });
    socket.on('messageDeleted', (messageId) => {
      setMessages(prev => prev.filter(msg => msg._id !== messageId));
    });
    socket.on('typing', ({ senderPhone, groupId: typingGroupId, isTyping }) => {
      setTyping(prev => ({ ...prev, [senderPhone + (typingGroupId || '')]: isTyping }));
    });
    socket.on('userStatus', ({ phoneNumber: userPhone, isOnline }) => {
      setUsers(prev =>
        prev.map(user =>
          user.phoneNumber === userPhone ? { ...user, isOnline, lastSeen: new Date() } : user
        )
      );
    });
    socket.on('groupCreated', (group) => {
      if (group.members.includes(phoneNumber)) {
        setGroups(prev => [...prev, group]);
      }
    });
    return () => {
      socket.off('message');
      socket.off('messageStatus');
      socket.off('messageDeleted');
      socket.off('typing');
      socket.off('userStatus');
      socket.off('groupCreated');
    };
  }, [phoneNumber]);

  useEffect(() => {
    if (isRegistered && phoneNumber) {
      socket.emit('join', phoneNumber);
      axios.get('/api/users')
        .then(res => setUsers(res.data.filter(user => user.phoneNumber !== phoneNumber)))
        .catch(err => setError('Error fetching users: ' + err.message));
      axios.get(`/api/groups/${phoneNumber}`)
        .then(res => setGroups(res.data))
        .catch(err => setError('Error fetching groups: ' + err.message));
    }
  }, [isRegistered, phoneNumber]);

  useEffect(() => {
    if (isRegistered && (contactPhone || groupId)) {
      const endpoint = groupId
        ? `/api/group-messages/${groupId}`
        : `/api/messages/${phoneNumber}/${contactPhone}`;
      axios.get(endpoint)
        .then(res => setMessages(res.data))
        .catch(err => setError('Error fetching messages: ' + err.message));
    }
  }, [contactPhone, groupId, isRegistered, phoneNumber]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    if (isLoginMode) {
      if (!phoneNumber) {
        setError('Phone number required');
        return;
      }
      try {
        const res = await axios.post('/api/login', { phoneNumber });
        setUsername(res.data.user.username);
        setIsRegistered(true);
      } catch (err) {
        setError(err.response?.data?.error || 'Login failed');
      }
    } else {
      if (!phoneNumber || !username) {
        setError('Phone number and username required');
        return;
      }
      try {
        const res = await axios.post('/api/register', { phoneNumber, username });
        setUsername(res.data.user.username);
        setIsRegistered(true);
      } catch (err) {
        setError(err.response?.data?.error || 'Registration failed');
      }
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if ((message.trim() || file) && (contactPhone || groupId)) {
      try {
        const formData = new FormData();
        formData.append('senderPhone', phoneNumber);
        if (contactPhone) formData.append('receiverPhone', contactPhone);
        if (groupId) formData.append('groupId', groupId);
        if (message) formData.append('message', message);
        if (file) formData.append('file', file);
        await axios.post('/api/messages', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        setMessage('');
        setFile(null);
        fileInputRef.current.value = '';
        socket.emit('typing', { senderPhone: phoneNumber, receiverPhone: contactPhone, groupId, isTyping: false });
      } catch (err) {
        setError('Error sending message: ' + err.message);
      }
    }
  };

  const handleTyping = (e) => {
    setMessage(e.target.value);
    if (contactPhone || groupId) {
      socket.emit('typing', { senderPhone: phoneNumber, receiverPhone: contactPhone, groupId, isTyping: true });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing', { senderPhone: phoneNumber, receiverPhone: contactPhone, groupId, isTyping: false });
      }, 2000);
    }
  };

  const handleDeleteMessage = async (messageId) => {
    try {
      await axios.delete(`/api/messages/${messageId}`);
    } catch (err) {
      setError('Error deleting message: ' + err.message);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (newGroupName && selectedMembers.length > 0) {
      try {
        await axios.post('/api/groups', {
          name: newGroupName,
          members: [...selectedMembers, phoneNumber],
          createdBy: phoneNumber
        });
        setNewGroupName('');
        setSelectedMembers([]);
      } catch (err) {
        setError('Error creating group: ' + err.message);
      }
    }
  };

  const handleSearchMessages = async () => {
    if (searchQuery && phoneNumber) {
      try {
        const res = await axios.get(`/api/search-messages/${phoneNumber}/${encodeURIComponent(searchQuery)}`);
        setMessages(res.data);
      } catch (err) {
        setError('Error searching messages: ' + err.message);
      }
    }
  };

  const getAvatar = (username) => {
    const firstLetter = username[0]?.toUpperCase() || 'U';
    return (
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        background: '#25D366',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        marginRight: '10px',
      }}>
        {firstLetter}
      </div>
    );
  };

  const formatLastSeen = (lastSeen) => {
    const date = new Date(lastSeen);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday
      ? `Last seen today at ${date.toLocaleTimeString()}`
      : `Last seen ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
  };

  if (!isRegistered) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#f0f0f0',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '15px',
          padding: '30px',
          background: 'white',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          width: '300px',
        }}>
          <h2 style={{ textAlign: 'center', color: '#25D366' }}>
            {isLoginMode ? 'Login' : 'Register'}
          </h2>
          {error && <div style={{ color: 'red', textAlign: 'center' }}>{error}</div>}
          <form onSubmit={handleAuth}>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Phone number (+1234567890)"
              required
              style={{
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '20px',
                fontSize: '16px',
                marginBottom: '10px',
                width: '100%',
              }}
            />
            {!isLoginMode && (
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                required
                style={{
                  padding: '10px',
                  border: '1px solid #ccc',
                  borderRadius: '20px',
                  fontSize: '16px',
                  marginBottom: '10px',
                  width: '100%',
                }}
              />
            )}
            <button type="submit" style={{
              padding: '10px',
              background: '#25D366',
              color: 'white',
              border: 'none',
              borderRadius: '20px',
              cursor: 'pointer',
              fontSize: '16px',
              width: '100%',
              transition: 'background 0.3s',
            }}>
              {isLoginMode ? 'Login' : 'Register'}
            </button>
          </form>
          <button
            onClick={() => {
              setIsLoginMode(!isLoginMode);
              setError('');
              setPhoneNumber('');
              setUsername('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#25D366',
              textAlign: 'center',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            {isLoginMode ? 'Need to register? Sign up' : 'Already registered? Login'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      maxWidth: '1200px',
      margin: '20px auto',
      background: '#f0f0f0',
      borderRadius: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      height: '85vh',
    }}>
      <div style={{
        width: '30%',
        background: 'white',
        borderRight: '1px solid #ccc',
        overflowY: 'auto',
        padding: '10px',
      }}>
        <h2 style={{ padding: '10px', color: '#25D366', borderBottom: '1px solid #ccc' }}>
          Chats
        </h2>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages..."
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '20px',
            }}
            onKeyPress={(e) => e.key === 'Enter' && handleSearchMessages()}
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <form onSubmit={handleCreateGroup}>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
              style={{
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '20px',
                width: '100%',
                marginBottom: '5px',
              }}
            />
            <select
              multiple
              value={selectedMembers}
              onChange={(e) => setSelectedMembers([...e.target.selectedOptions].map(opt => opt.value))}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '12px',
                marginBottom: '5px',
              }}
            >
              {users.map(user => (
                <option key={user.phoneNumber} value={user.phoneNumber}>
                  {user.username}
                </option>
              ))}
            </select>
            <button type="submit" style={{
              padding: '8px',
              background: '#25D366',
              color: 'white',
              border: 'none',
              borderRadius: '20px',
              width: '100%',
            }}>
              Create Group
            </button>
          </form>
        </div>
        {users.map(user => (
          <div
            key={user.phoneNumber}
            onClick={() => {
              setContactPhone(user.phoneNumber);
              setGroupId('');
              setMessages([]);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px',
              cursor: 'pointer',
              background: contactPhone === user.phoneNumber ? '#e6e6e6' : 'white',
              borderBottom: '1px solid #eee',
              transition: 'background 0.2s',
            }}
          >
            {getAvatar(user.username)}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
                {user.username}
              </div>
              <div style={{ fontSize: '0.8em', color: user.isOnline ? '#25D366' : '#666' }}>
                {user.isOnline ? 'Online' : formatLastSeen(user.lastSeen)}
              </div>
            </div>
          </div>
        ))}
        {groups.map(group => (
          <div
            key={group._id}
            onClick={() => {
              setGroupId(group._id);
              setContactPhone('');
              setMessages([]);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px',
              cursor: 'pointer',
              background: groupId === group._id ? '#e6e6e6' : 'white',
              borderBottom: '1px solid #eee',
              transition: 'background 0.2s',
            }}
          >
            {getAvatar(group.name)}
            <div>
              <div style={{ fontWeight: 'bold' }}>{group.name}</div>
              <div style={{ fontSize: '0.8em', color: '#666' }}>
                Group Chat
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {(contactPhone || groupId) ? (
          <>
            <div style={{
              padding: '15px',
              background: '#075E54',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              borderBottom: '1px solid #ccc',
            }}>
              {groupId ? (
                <>
                  {getAvatar(groups.find(g => g._id === groupId)?.name || 'Group')}
                  <div>
                    <div style={{ fontWeight: 'bold' }}>
                      {groups.find(g => g._id === groupId)?.name || 'Group'}
                    </div>
                    <div style={{ fontSize: '0.9em' }}>
                      {groups.find(g => g._id === groupId)?.members.join(', ')}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {getAvatar(users.find(u => u.phoneNumber === contactPhone)?.username || 'User')}
                  <div>
                    <div style={{ fontWeight: 'bold' }}>
                      {users.find(u => u.phoneNumber === contactPhone)?.username || 'User'}
                    </div>
                    <div style={{ fontSize: '0.9em' }}>
                      {typing[contactPhone] ? 'Typing...' : users.find(u => u.phoneNumber === contactPhone)?.isOnline ? 'Online' : formatLastSeen(users.find(u => u.phoneNumber === contactPhone)?.lastSeen)}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              background: '#E5DDD5',
              padding: '15px',
            }}>
              {messages.map((msg, index) => (
                <div key={index} style={{
                  margin: '10px 0',
                  padding: '10px',
                  borderRadius: '8px',
                  background: msg.senderPhone === phoneNumber ? '#DCF8C6' : 'white',
                  marginLeft: msg.senderPhone === phoneNumber ? '20%' : '5%',
                  marginRight: msg.senderPhone === phoneNumber ? '5%' : '20%',
                  boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
                  position: 'relative',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {msg.senderPhone !== phoneNumber && getAvatar(users.find(u => u.phoneNumber === msg.senderPhone)?.username || 'User')}
                    <div>
                      {msg.message && <div>{msg.message}</div>}
                      {msg.fileUrl && (
                        msg.fileType.startsWith('image') ? (
                          <img src={msg.fileUrl} alt="Attachment" style={{ maxWidth: '200px', borderRadius: '8px', margin: '5px 0' }} />
                        ) : (
                          <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'blue', textDecoration: 'underline' }}>
                            {msg.fileUrl.split('/').pop()}
                          </a>
                        )
                      )}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '0.8em',
                    color: '#666',
                    textAlign: msg.senderPhone === phoneNumber ? 'right' : 'left',
                  }}>
                    {new Date(msg.timestamp).toLocaleString()}
                    {msg.senderPhone === phoneNumber && (
                      <span style={{ marginLeft: '5px' }}>
                        {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>
                  {msg.senderPhone === phoneNumber && (
                    <button 
                      onClick={() => handleDeleteMessage(msg._id)}
                      style={{
                        position: 'absolute',
                        top: '5px',
                        right: '10px',
                        background: 'none',
                        border: 'none',
                        color: '#ff4d4f',
                        cursor: 'pointer',
                      }}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSendMessage} style={{
              display: 'flex',
              gap: '10px',
              padding: '15px',
              background: '#f0f0f0',
              borderTop: '1px solid #ccc',
            }}>
              <input
                type="text"
                value={message}
                onChange={handleTyping}
                placeholder="Type a message"
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid #ccc',
                  borderRadius: '20px',
                  fontSize: '16px',
                }}
              />
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => setFile(e.target.files[0])}
                style={{
                  padding: '10px',
                }}
              />
              <button type="submit" style={{
                padding: '10px 20px',
                background: '#25D366',
                color: 'white',
                border: 'none',
                borderRadius: '20px',
                cursor: 'pointer',
                fontSize: '16px',
              }}>
                Send
              </button>
            </form>
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666',
          }}>
            Select a chat or group to start
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
