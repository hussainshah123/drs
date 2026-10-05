/**
 * @format
 */

// Must come first: TextEncoder/TextDecoder for protobufjs (Hermes lacks them).
import './src/polyfills';
// Provides crypto.getRandomValues for tweetnacl key generation.
import 'react-native-get-random-values';
// Installs RTCPeerConnection, mediaDevices, etc. as globals for react-native-webrtc.
import { registerGlobals } from 'react-native-webrtc';
registerGlobals();

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
