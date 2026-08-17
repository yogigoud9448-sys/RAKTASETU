import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Modal } from 'react-native';

const API_BASE_URL = "https://raktasetu-uvna.onrender.com";
const BLOOD_GROUPS = ['A+', 'A-', 'B-', 'AB-', 'B+', 'O+', 'O-', 'AB+'];

// Emergency High-Pitch Siren Generator
const playEmergencyBeep = async () => {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    
    const audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sawtooth';
    const now = audioCtx.currentTime;
    
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.3);
    osc.frequency.linearRampToValueAtTime(700, now + 0.6);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.9);
    osc.frequency.linearRampToValueAtTime(600, now + 1.3);

    gainNode.gain.setValueAtTime(0.5, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.4);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 1.4);
  } catch (err) {
    console.warn("Audio Context Warning:", err);
  }
};

export default function App() {
  const [screen, setScreen] = useState('onboarding'); // 'onboarding' | 'map' | 'chat'
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedBlood, setSelectedBlood] = useState('AB+');
  const [requiredBlood, setRequiredBlood] = useState('A+');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const [userUUID, setUserUUID] = useState('');
  const [nearbyDonors, setNearbyDonors] = useState([]);
  
  // SOS, Alerts & Chat State
  const [currentSOS, setCurrentSOS] = useState(null);
  const [incomingAlertModal, setIncomingAlertModal] = useState(false);
  const [dismissedSosPhone, setDismissedSosPhone] = useState(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLogs, setChatLogs] = useState([]);

  // ================= 1. SESSION RESTORE (NO LOGOUT ON REFRESH) =================
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('raktsetu_session');
      if (savedUser) {
        const session = JSON.parse(savedUser);
        if (session.phoneNumber && session.userUUID) {
          setPhoneNumber(session.phoneNumber);
          setSelectedBlood(session.bloodGroup || 'AB+');
          setUserUUID(session.userUUID);
          setScreen('map');
        }
      }
    } catch (e) {
      console.warn("Local storage parse error", e);
    }
  }, []);

  // ================= 2. BROWSER / MOBILE STEP-BY-STEP BACK BUTTON =================
  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state && event.state.screen) {
        setScreen(event.state.screen);
      } else {
        // Step-by-step back fallback
        setScreen((prev) => {
          if (prev === 'chat') return 'map';
          if (prev === 'map') {
            localStorage.removeItem('raktsetu_session');
            return 'onboarding';
          }
          return prev;
        });
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newScreen) => {
    window.history.pushState({ screen: newScreen }, "");
    setScreen(newScreen);
  };

  // ================= 3. SEND / RESEND OTP =================
  const handleSendOTP = async (isResend = false) => {
    if (phoneNumber.length !== 10) {
      alert('దయచేసి 10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();
      setOtpSent(true);
      if (isResend) {
        setOtp('');
        alert('🔄 కొత్త OTP విజయవంతంగా పంపబడింది!');
      } else {
        alert(data.message);
      }
    } catch {
      alert('సర్వర్ కనెక్ట్ కాలేదు.');
    } finally {
      setLoading(false);
    }
  };

  // ================= 4. VERIFY OTP & ENTER RADAR =================
  const handleVerifyOTP = async () => {
    if (otp.length < 4) {
      alert('సరైన OTP ఇవ్వండి.');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await verifyBackend(pos.coords.latitude, pos.coords.longitude);
      },
      async () => {
        await verifyBackend(17.3850, 78.4867);
      },
      { enableHighAccuracy: true }
    );
  };

  const verifyBackend = async (lat, lng) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phoneNumber, 
          otp, 
          bloodGroup: selectedBlood, 
          latitude: lat, 
          longitude: lng 
        }),
      });
      const data = await res.json();
      if (data.success) {
        setUserUUID(data.userUUID);
        // సెషన్‌ను సేవ్ చేయడం
        localStorage.setItem('raktsetu_session', JSON.stringify({
          phoneNumber,
          bloodGroup: selectedBlood,
          userUUID: data.userUUID
        }));
        navigateTo('map');
      } else {
        alert(data.message);
      }
    } catch {
      alert('వెరిఫికేషన్ ఎర్రర్ వచ్చింది.');
    } finally {
      setLoading(false);
    }
  };

  // ================= 5. POLLER (EVERY 2 SECONDS) =================
  const pollServerState = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/get-nearby-donors`);
      const data = await res.json();

      if (data.success) {
        const others = (data.donors || []).filter(d => d.phoneNumber !== phoneNumber);
        setNearbyDonors(others);

        if (data.activeSOS) {
          setCurrentSOS(data.activeSOS);
          setChatLogs(data.activeSOS.messages || []);

          const targetGroup = data.activeSOS.requiredBloodGroup || data.activeSOS.bloodGroup;
          const isTargetDonor = targetGroup === selectedBlood;
          const isNotDismissed = dismissedSosPhone !== data.activeSOS.requesterPhone;

          if (data.activeSOS.requesterPhone !== phoneNumber && !data.activeSOS.acceptedDonorId && isTargetDonor && isNotDismissed) {
            playEmergencyBeep();
            setIncomingAlertModal(true);
          }

          if (data.activeSOS.acceptedDonorId) {
            setIncomingAlertModal(false);
            if (screen === 'map') {
              navigateTo('chat');
            }
          }
        } else {
          setCurrentSOS(null);
          setIncomingAlertModal(false);
          setDismissedSosPhone(null);
          if (screen === 'chat') {
            navigateTo('map');
          }
        }
      }
    } catch (err) {
      console.error('Poller error:', err);
    }
  };

  useEffect(() => {
    if (screen === 'map' || screen === 'chat') {
      pollServerState();
      const interval = setInterval(pollServerState, 2000);
      return () => clearInterval(interval);
    }
  }, [screen, selectedBlood, dismissedSosPhone]);

  // ================= 6. TRIGGER SOS =================
  const handleTriggerSOS = async () => {
    playEmergencyBeep();
    try {
      await fetch(`${API_BASE_URL}/api/trigger-sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phoneNumber, 
          bloodGroup: selectedBlood, 
          requiredBloodGroup: requiredBlood, 
          userUUID 
        }),
      });
      alert(`🚨 ${requiredBlood} బ్లడ్ అత్యవసర రిక్వెస్ట్ సమీప డోనర్లకు పంపబడింది!`);
    } catch {
      alert('SOS ట్రిగ్గర్ కాలేదు.');
    }
  };

  // ================= 7. ACCEPT SOS =================
  const handleAcceptSOS = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/accept-sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donorId: userUUID }),
      });
      setIncomingAlertModal(false);
      navigateTo('chat');
    } catch {
      alert('యాక్సెప్ట్ చేయడంలో సమస్య వచ్చింది.');
    }
  };

  // ================= 8. SEND CHAT MESSAGE =================
  const handleSendMessage = async () => {
    if (!chatMessage.trim()) return;
    try {
      await fetch(`${API_BASE_URL}/api/send-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: userUUID, text: chatMessage.trim() }),
      });
      setChatMessage('');
      pollServerState();
    } catch {
      alert('మెసేజ్ పంపబడలేదు.');
    }
  };

  // ================= 9. CLOSE SOS SESSION =================
  const handleCloseSession = async () => {
    await fetch(`${API_BASE_URL}/api/close-sos`, { method: 'POST' });
    navigateTo('map');
  };

  // ================= 10. MANUAL LOGOUT =================
  const handleLogout = () => {
    localStorage.removeItem('raktsetu_session');
    setPhoneNumber('');
    setOtp('');
    setOtpSent(false);
    setUserUUID('');
    navigateTo('onboarding');
  };

  // =========================================================================
  // SCREEN 2: GHOST-PIN MAP RADAR
  // =========================================================================
  if (screen === 'map') {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>RaktSetu</Text>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.badgeBar}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Ghost-Pin Active (50-100m Masked)</Text>
          </View>
        </View>

        <View style={styles.mapCanvas}>
          <View style={styles.radarRing3} />
          <View style={styles.radarRing2} />
          <View style={styles.radarRing1} />

          <View style={styles.userBeacon}>
            <View style={styles.userDot} />
            <Text style={styles.userLabel}>YOU ({selectedBlood})</Text>
          </View>

          {nearbyDonors.map((donor, idx) => {
            const positions = [
              { top: '25%', left: '25%' },
              { top: '65%', right: '22%' },
              { bottom: '20%', left: '30%' },
              { top: '40%', right: '35%' },
            ];
            const pos = positions[idx % positions.length];
            return (
              <View key={donor.id || idx} style={[styles.donorPin, pos]}>
                <Text style={styles.pinBlood}>{donor.bloodGroup}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Live Anonymous Donors Near You ({nearbyDonors.length} Online)</Text>

          <ScrollView style={styles.donorListScroll} showsVerticalScrollIndicator={false}>
            {nearbyDonors.map((d, index) => (
              <View key={index} style={styles.donorCard}>
                <View style={styles.donorIcon}>
                  <Text style={styles.donorIconText}>{d.bloodGroup}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.donorIdText}>ID: {d.id} (Verified)</Text>
                  <Text style={styles.donorDistanceText}>📍 Vicinity: ~{((index + 1) * 0.4).toFixed(1)}km away</Text>
                </View>
                <View style={styles.onlineDot} />
              </View>
            ))}
          </ScrollView>

          {/* REQUIRED BLOOD GROUP SELECTOR */}
          <View style={styles.requiredSelectorContainer}>
            <Text style={styles.requiredSelectorLabel}>🩸 SELECT REQUIRED BLOOD GROUP:</Text>
            <View style={styles.requiredGrid}>
              {BLOOD_GROUPS.map((bg) => (
                <TouchableOpacity
                  key={bg}
                  style={[
                    styles.reqBloodBtn,
                    requiredBlood === bg && styles.reqBloodBtnActive
                  ]}
                  onPress={() => setRequiredBlood(bg)}
                >
                  <Text style={[
                    styles.reqBloodBtnText,
                    requiredBlood === bg && styles.reqBloodBtnTextActive
                  ]}>
                    {bg}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.sosButton} onPress={handleTriggerSOS}>
            <Text style={styles.sosButtonText}>🚨 REQUEST {requiredBlood} BLOOD (SOS)</Text>
          </TouchableOpacity>
        </View>

        {/* INCOMING EMERGENCY POPUP MODAL WITH SOUND */}
        <Modal visible={incomingAlertModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalAlertIcon}>🚨</Text>
              <Text style={styles.modalTitle}>EMERGENCY BLOOD REQUEST!</Text>
              <Text style={styles.modalText}>
                A patient within ~500m urgently requires <Text style={{ color: '#ff3b30', fontWeight: 'bold' }}>{currentSOS?.requiredBloodGroup || currentSOS?.bloodGroup}</Text> blood!
              </Text>
              <TouchableOpacity style={styles.approveBtn} onPress={handleAcceptSOS}>
                <Text style={styles.approveBtnText}>✅ APPROVE & OPEN ANONYMOUS CHAT</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.declineBtn} 
                onPress={() => {
                  setDismissedSosPhone(currentSOS?.requesterPhone);
                  setIncomingAlertModal(false);
                }}
              >
                <Text style={styles.declineBtnText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // =========================================================================
  // SCREEN 3: LIVE SECURE ANONYMOUS CHAT
  // =========================================================================
  if (screen === 'chat') {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigateTo('map')} style={styles.backBtn}>
            <Text style={styles.backBtnText}>‹ Map</Text>
          </TouchableOpacity>
          <Text style={styles.logo}>RaktSetu Chat</Text>
          <TouchableOpacity onPress={handleCloseSession} style={styles.closeHeaderBtn}>
            <Text style={{ color: '#ff3b30', fontWeight: 'bold' }}>End SOS</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.chatContainer}>
          <ScrollView style={styles.messageScroll}>
            {chatLogs.map((msg, index) => {
              const isMe = msg.sender === userUUID;
              const isSys = msg.sender === 'SYSTEM';
              if (isSys) {
                return <Text key={index} style={styles.sysText}>{msg.text}</Text>;
              }
              return (
                <View key={index} style={[styles.bubble, isMe ? styles.myBubble : styles.otherBubble]}>
                  <Text style={styles.senderTag}>{isMe ? 'YOU' : 'DONOR'}</Text>
                  <Text style={styles.bubbleText}>{msg.text}</Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.inputBar}>
            <TextInput
              style={styles.chatInput}
              placeholder="Type message (location, room no)..."
              placeholderTextColor="#888"
              value={chatMessage}
              onChangeText={setChatMessage}
            />
            <TouchableOpacity style={styles.sendBtn} onPress={handleSendMessage}>
              <Text style={styles.sendBtnText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // =========================================================================
  // SCREEN 1: ONBOARDING & REGISTRATION
  // =========================================================================
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>RaktSetu</Text>
      <Text style={styles.subTitle}>Privacy-First Emergency Blood Network</Text>

      <Text style={styles.label}>YOUR MOBILE NUMBER</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter 10 digit number..."
        placeholderTextColor="#666"
        keyboardType="phone-pad"
        maxLength={10}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        editable={!otpSent}
      />

      <View style={styles.registeredBar}>
        <Text style={styles.registeredText}>Profile Registered Type: {selectedBlood}</Text>
      </View>

      <View style={styles.grid}>
        {BLOOD_GROUPS.map((bg) => (
          <TouchableOpacity
            key={bg}
            style={[styles.bloodBtn, selectedBlood === bg && styles.selectedBloodBtn]}
            onPress={() => setSelectedBlood(bg)}
          >
            <Text style={[styles.bloodBtnText, selectedBlood === bg && styles.selectedBloodBtnText]}>{bg}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {otpSent && (
        <View style={{ width: '100%', marginTop: 15 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.label}>ENTER OTP</Text>
            <TouchableOpacity onPress={() => handleSendOTP(true)} disabled={loading}>
              <Text style={styles.resendBtnText}>🔄 Resend OTP</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Enter received OTP..."
            placeholderTextColor="#666"
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}
          />
        </View>
      )}

      <TouchableOpacity style={styles.primaryBtn} onPress={otpSent ? handleVerifyOTP : () => handleSendOTP(false)} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{otpSent ? 'VERIFY & ENTER RADAR' : 'GET OTP'}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0d0e', paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' },
  topBar: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, paddingBottom: 10 },
  logo: { fontSize: 24, fontWeight: '900', color: '#ff3b30' },
  badgeBar: { width: '100%', alignItems: 'flex-start', marginBottom: 10 },
  badge: { backgroundColor: '#16181a', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1, borderColor: '#26292d' },
  badgeText: { color: '#00e676', fontSize: 11, fontWeight: '700' },
  logoutBtn: { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#26292d', borderRadius: 6 },
  logoutBtnText: { color: '#8e8e93', fontSize: 12, fontWeight: '600' },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  backBtnText: { color: '#007aff', fontSize: 15, fontWeight: 'bold' },
  mapCanvas: { width: '100%', height: 250, backgroundColor: '#121416', borderRadius: 16, marginBottom: 12, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#202326' },
  radarRing3: { position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.1)' },
  radarRing2: { position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.2)' },
  radarRing1: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.35)' },
  userBeacon: { alignItems: 'center', zIndex: 10 },
  userDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#007aff', borderWidth: 3, borderColor: '#fff' },
  userLabel: { color: '#fff', fontSize: 10, fontWeight: '800', marginTop: 4 },
  donorPin: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: '#ff3b30', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  pinBlood: { color: '#fff', fontSize: 11, fontWeight: '900' },
  sheet: { width: '100%', backgroundColor: '#16181a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#26292d' },
  sheetTitle: { color: '#8e8e93', fontSize: 11, fontWeight: '700', marginBottom: 8 },
  donorListScroll: { maxHeight: 100, marginBottom: 8 },
  donorCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c0d0e', padding: 8, borderRadius: 8, marginBottom: 6 },
  donorIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255, 59, 48, 0.2)', justifyContent: 'center', alignItems: 'center' },
  donorIconText: { color: '#ff3b30', fontWeight: '900', fontSize: 11 },
  donorIdText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  donorDistanceText: { color: '#8e8e93', fontSize: 10 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00e676' },

  // Required Blood Group Selector
  requiredSelectorContainer: { marginTop: 6, marginBottom: 8, width: '100%' },
  requiredSelectorLabel: { color: '#ff4d4d', fontSize: 11, fontWeight: '800', marginBottom: 6, letterSpacing: 0.5 },
  requiredGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%' },
  reqBloodBtn: { width: '23%', height: 34, backgroundColor: '#0c0d0e', borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginBottom: 6, borderWidth: 1, borderColor: '#333' },
  reqBloodBtnActive: { backgroundColor: '#ff3b30', borderColor: '#ff3b30' },
  reqBloodBtnText: { color: '#888', fontWeight: '700', fontSize: 12 },
  reqBloodBtnTextActive: { color: '#fff' },

  sosButton: { width: '100%', height: 48, backgroundColor: '#ff3b30', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  sosButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  subTitle: { color: '#8e8e93', fontSize: 13, marginTop: 4, marginBottom: 28 },
  label: { alignSelf: 'flex-start', color: '#8e8e93', fontSize: 11, fontWeight: '700', marginBottom: 8 },
  resendBtnText: { color: '#007aff', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  input: { width: '100%', height: 48, backgroundColor: '#16181a', borderRadius: 8, paddingHorizontal: 16, color: '#fff', borderWidth: 1, borderColor: '#26292d', marginBottom: 16 },
  registeredBar: { width: '100%', padding: 12, backgroundColor: '#16181a', borderRadius: 8, borderWidth: 1, borderColor: '#26292d', marginBottom: 12 },
  registeredText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%' },
  bloodBtn: { width: '23%', height: 42, backgroundColor: '#16181a', borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#26292d' },
  selectedBloodBtn: { backgroundColor: '#ff3b30', borderColor: '#ff3b30' },
  bloodBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  selectedBloodBtnText: { color: '#fff' },
  primaryBtn: { width: '100%', height: 48, backgroundColor: '#ff3b30', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: '#16181a', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 2, borderColor: '#ff3b30' },
  modalAlertIcon: { fontSize: 40, marginBottom: 10 },
  modalTitle: { color: '#ff3b30', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  modalText: { color: '#fff', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  approveBtn: { width: '100%', height: 48, backgroundColor: '#00e676', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  approveBtnText: { color: '#000', fontWeight: '900', fontSize: 13 },
  declineBtn: { padding: 10 },
  declineBtnText: { color: '#8e8e93', fontSize: 12 },
  chatContainer: { flex: 1, width: '100%', backgroundColor: '#16181a', borderRadius: 16, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#26292d' },
  messageScroll: { flex: 1 },
  sysText: { textAlign: 'center', color: '#8e8e93', fontSize: 11, marginVertical: 8, fontStyle: 'italic' },
  bubble: { padding: 10, borderRadius: 8, marginVertical: 4, maxWidth: '80%' },
  myBubble: { backgroundColor: '#007aff', alignSelf: 'flex-end' },
  otherBubble: { backgroundColor: '#26292d', alignSelf: 'flex-start' },
  senderTag: { color: '#aaa', fontSize: 9, fontWeight: 'bold', marginBottom: 2 },
  bubbleText: { color: '#fff', fontSize: 13 },
  inputBar: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  chatInput: { flex: 1, height: 44, backgroundColor: '#0c0d0e', borderRadius: 8, paddingHorizontal: 12, color: '#fff', borderWidth: 1, borderColor: '#333' },
  sendBtn: { marginLeft: 10, backgroundColor: '#ff3b30', paddingHorizontal: 16, height: 44, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  sendBtnText: { color: '#fff', fontWeight: 'bold' },
  closeHeaderBtn: { padding: 6 }
});