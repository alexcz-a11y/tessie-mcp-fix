#!/usr/bin/env node

import axios from 'axios';

const API_TOKEN = 'PL3jMQCGMk02SIHziqwpegeZj3YWEsD6';
const VIN = 'LRWYGCEK8RC606925';

async function testTirePressure() {
  try {
    console.log('Testing Tessie Tire Pressure API...\n');
    
    const response = await axios.get(
      `https://api.tessie.com/${VIN}/tire_pressure?pressure_format=psi`,
      {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    console.log('✅ API Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    const data = response.data;
    console.log('\n📊 Tire Pressure Summary:');
    console.log(`Front Left:  ${data.front_left} PSI - ${data.front_left_status}`);
    console.log(`Front Right: ${data.front_right} PSI - ${data.front_right_status}`);
    console.log(`Rear Left:   ${data.rear_left} PSI - ${data.rear_left_status}`);
    console.log(`Rear Right:  ${data.rear_right} PSI - ${data.rear_right_status}`);
    console.log(`\nTimestamp: ${new Date(data.timestamp * 1000).toISOString()}`);
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
  }
}

testTirePressure();
