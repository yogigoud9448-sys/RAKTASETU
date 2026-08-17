import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Modal } from 'react-native';

const API_BASE_URL = "https://raktasetu-uvna.onrender.com";
const BLOOD_GROUPS = ['A+', 'A-', 'B-', 'AB-', 'B+', 'O+', 'O-', 'AB+'];

// High-Pitch Emergency Siren (Web Audio API with Auto-Resume)
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
    
    // Siren Frequency Modulation (High-Low-High Siren Pitch)
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.3);
    osc.frequency.linearRampToValueAtTime(700, now + 0.6);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.9);
    osc.frequency.linearRampToValueAtTime(600, now + 1.3);

    // Volume ramp
    gainNode.gain.setValueAtTime(0.5, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.4);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 1.4);
  } catch (err) {
    console.warn("Audio Play Error:", err);
  }
};

export default function App() {
  const [screen, setScreen] = useState('onboarding');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedBlood, setSelectedBlood] = useState('AB+'); // డోనర్ గ్రూప్
  const [requiredBlood, setRequiredBlood] = useState('A+');   // కావాల్సిన గ్రూప్
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const [userUUID, setUserUUID] = useState('');
  const [nearbyDonors, setNearbyDonors] = useState([]);
  
  // SOS & Chat State
  const [currentSOS, setCurrentSOS] = useState(null);
  const [incomingAlertModal, setIncomingAlertModal] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLogs, setChatLogs] = useState([]);
  
  // Ref to prevent continuous re-alert looping
  const lastAlertedSosId = useRef(null);

  // 1. Send OTP
  const handleSendOTP = async () => {
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
      alert(data.message);
    } catch {
      alert('సర్వర్ కనెక్ట్ కాలేదు.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Verify OTP & Enter Radar
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
        body: JSON.stringify({ phoneNumber, otp, bloodGroup: selectedBlood, latitude: lat, longitude: lng }),
      });
      const data = await res.json();
      if (data.success) {
        setUserUUID(data.userUUID);
        setScreen('map');
      } else {
        alert(data.message);
      }
    } catch {
      alert('వెరిఫికేషన్ ఎర్రర్ వచ్చింది.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Radar & Emergency Poller
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

          // చెకింగ్: అడిగిన గ్రూప్ లేదా డిఫాల్ట్ గ్రూప్ నా బ్లడ్ గ్రూప్‌తో మ్యాచ్ అయిందా
          const targetGroup = data.activeSOS.requiredBloodGroup || data.activeSOS.bloodGroup;
          const isTargetDonor = targetGroup === selectedBlood;

          if (data.activeSOS.requesterPhone !== phoneNumber && !data.activeSOS.acceptedDonorId && isTargetDonor) {
            playEmergencyBeep();
            setIncomingAlertModal(true);
          }

          if (data.activeSOS.acceptedDonorId) {
            setIncomingAlertModal(false);
            if (screen === 'map') setScreen('chat');
          }
        } else {
          setCurrentSOS(null);
          setIncomingAlertModal(false);
          if (screen === 'chat') setScreen('map');
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
  }, [screen, selectedBlood]);

  // 4. Trigger Emergency Blood SOS
  const handleTriggerSOS = async () => {
    // బటన్ నొక్కినప్పుడే యూజర్ యొక్క ఆడియో సందర్భాన్ని ఒకసారి అన్‌లాక్ చేద్దాం
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
      setScreen('chat');
    } catch {
      alert('SOS ట్రిగ్గర్ కాలేదు.');
    }
  };

  // 5. Donor Approves Request
  const handleAcceptSOS = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/accept-sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donorId: userUUID }),
      });
      setIncomingAlertModal(false);
      setScreen('chat');
    } catch {
      alert('యాక్సెప్ట్ చేయడంలో సమస్య వచ్చింది.');
    }
  };

  // 6. Send Anonymous Chat Message
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

  // 7. Close Chat Session & Purge
  const handleCloseSession = async () => {
    await fetch(`${API_BASE_URL}/api/close-sos`, { method: 'POST' });
    setScreen('map');
  };

  // ================= SCREEN 2: GHOST-PIN MAP RADAR =================
  if (screen === 'map') {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>RaktSetu</Text>
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

        {/* INCOMING EMERGENCY POPUP MODAL */}
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
              <TouchableOpacity style={styles.declineBtn} onPress={() => setIncomingAlertModal(false)}>
                <Text style={styles.declineBtnText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ================= SCREEN 3: LIVE SECURE ANONYMOUS CHAT =================
  if (screen === 'chat') {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>RaktSetu Secure Chat</Text>
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

  // ================= SCREEN 1: ONBOARDING =================
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
        <View style={{ width: '100%', marginTop: 20 }}>
          <Text style={styles.label}>ENTER OTP</Text>
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

      <TouchableOpacity style={styles.primaryBtn} onPress={otpSent ? handleVerifyOTP : handleSendOTP} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{otpSent ? 'VERIFY & ENTER RADAR' : 'GET OTP'}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0d0e', paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' },
  topBar: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 25, paddingBottom: 15 },
  logo: { fontSize: 24, fontWeight: '900', color: '#ff3b30' },
  badge: { backgroundColor: '#16181a', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1, borderColor: '#26292d' },
  badgeText: { color: '#00e676', fontSize: 11, fontWeight: '700' },
  mapCanvas: { width: '100%', height: 260, backgroundColor: '#121416', borderRadius: 16, marginVertical: 12, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#202326' },
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
  donorCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c0d0e', padding: 8, borderRadius: 8, marginBottom: 6 },
  donorIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255, 59, 48, 0.2)', justifyContent: 'center', alignItems: 'center' },
  donorIconText: { color: '#ff3b30', fontWeight: '900', fontSize: 11 },
  donorIdText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  donorDistanceText: { color: '#8e8e93', fontSize: 10 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00e676' },
  requiredSelectorContainer: { marginTop: 10, marginBottom: 8, width: '100%' },
  requiredSelectorLabel: { color: '#ff4d4d', fontSize: 11, fontWeight: '800', marginBottom: 6, letterSpacing: 0.5 },
  requiredGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%' },
  reqBloodBtn: { width: '23%', height: 34, backgroundColor: '#0c0d0e', borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginBottom: 6, borderWidth: 1, borderColor: '#333' },
  reqBloodBtnActive: { backgroundColor: '#ff3b30', borderColor: '#ff3b30' },
  reqBloodBtnText: { color: '#888', fontWeight: '700', fontSize: 12 },
  reqBloodBtnTextActive: { color: '#fff' },
  sosButton: { width: '100%', height: 48, backgroundColor: '#ff3b30', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 6 },
  sosButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  subTitle: { color: '#8e8e93', fontSize: 13, marginTop: 4, marginBottom: 28 },
  label: { alignSelf: 'flex-start', color: '#8e8e93', fontSize: 11, fontWeight: '700', marginBottom: 8 },
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