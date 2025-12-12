import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

const APP_NAME = appName || 'dinodia-mobile';

AppRegistry.registerComponent(APP_NAME, () => App);

if (APP_NAME !== 'dinodia-mobile') {
  AppRegistry.registerComponent('dinodia-mobile', () => App);
}
