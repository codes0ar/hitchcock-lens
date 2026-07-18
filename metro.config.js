const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 优先用编译产物(lib/)而非 source 字段(src/)，避免部分 RN 库源码需要额外 babel 插件
// (如 react-native-vision-camera-face-detector 的 src 需要 @babel/plugin-transform-template-literals)
config.resolver.resolverMainFields = ['react-native', 'browser', 'main', 'module'];

module.exports = config;
