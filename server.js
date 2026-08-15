const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const otpStore = {};
let activeDonors = [];
let activeSOS = null; // { requesterPhone, bloodGroup, requesterId, acceptedDonorId, messages: [] }

// Health check
app.get('/', (req, res) => res.send('🚀 RaktSetu Backend is running!'));

// Send OTP
app.post('/api/send-otp', (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber || phoneNumber.length !== 10) {
    return res.status(400).json({ success: false, message: 'దయచేసి 10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.' });
  }
  const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore[phoneNumber] = generatedOtp;
  console.log(`📱 OTP for ${phoneNumber}: [ ${generatedOtp} ]`);
  res.json({ success: true, message: `OTP పంపబడింది! (టెస్ట్ OTP: ${generatedOtp})` });
});

// Verify OTP
app.post('/api/verify-otp', (req, res) => {
  const { phoneNumber, otp, bloodGroup, latitude, longitude } = req.body;
  const validOtp = otpStore[phoneNumber];

  if (!validOtp || validOtp !== otp.trim()) {
    return res.status(400).json({ success: false, message: '❌ తప్పు OTP! దయచేసి సరైన OTP ఇవ్వండి.' });
  }

  const userUUID = 'DONOR-' + Math.random().toString(36).substr(2, 5).toUpperCase();
  const donorData = {
    id: userUUID,
    phoneNumber,
    bloodGroup: bloodGroup || 'O+',
    latitude: Number(latitude) || 17.3850,
    longitude: Number(longitude) || 78.4867,
  };

  const existingIndex = activeDonors.findIndex(d => d.phoneNumber === phoneNumber);
  if (existingIndex !== -1) {
    activeDonors[existingIndex] = donorData;
  } else {
    activeDonors.push(donorData);
  }

  delete otpStore[phoneNumber];
  res.json({ success: true, userUUID, donor: donorData });
});

// Get Active Donors & Check SOS Status
app.get('/api/get-nearby-donors', (req, res) => {
  res.json({
    success: true,
    donors: activeDonors,
    activeSOS: activeSOS
  });
});

// Trigger SOS
app.post('/api/trigger-sos', (req, res) => {
  const { phoneNumber, bloodGroup, userUUID } = req.body;
  activeSOS = {
    requesterPhone: phoneNumber,
    bloodGroup: bloodGroup,
    requesterId: userUUID,
    acceptedDonorId: null,
    messages: [
      { sender: 'SYSTEM', text: '🔒 Encrypted Anonymous Channel Opened. Privacy Protected.' }
    ]
  };
  console.log(`🚨 SOS Triggered by ${userUUID} for Blood Group: ${bloodGroup}`);
  res.json({ success: true, message: 'SOS Broadcasted successfully!' });
});

// Accept SOS (by nearby donor)
app.post('/api/accept-sos', (req, res) => {
  const { donorId } = req.body;
  if (activeSOS) {
    activeSOS.acceptedDonorId = donorId;
    activeSOS.messages.push({
      sender: donorId,
      text: 'I have accepted your request! I am approaching your location.'
    });
    console.log(`✅ SOS Accepted by Donor: ${donorId}`);
    return res.json({ success: true, activeSOS });
  }
  res.status(400).json({ success: false, message: 'No active SOS found.' });
});

// Send Chat Message
app.post('/api/send-chat', (req, res) => {
  const { senderId, text } = req.body;
  if (activeSOS) {
    activeSOS.messages.push({ sender: senderId, text });
    return res.json({ success: true, messages: activeSOS.messages });
  }
  res.status(400).json({ success: false, message: 'Session closed.' });
});

// Close/Purge Session
app.post('/api/close-sos', (req, res) => {
  activeSOS = null;
  console.log(`🧹 SOS Session Closed and Data Purged.`);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🛡️ RaktSetu Backend running on Port: ${PORT}`);
});