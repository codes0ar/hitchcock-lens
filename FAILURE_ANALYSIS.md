# APK构建失败分析

## 失败原因清单

| # | 失败原因 | 根本原因 | 解决方案 |
|---|---------|---------|---------|
| 1 | /tmp 项目被定期清理 | 沙盒/tmp目录非持久化 | 将GRADLE缓存和关键文件放到/mnt/agents/output/ |
| 2 | $HOME 下载的工具被清理 | Gradle、Android SDK下载到$HOME后被清理 | 下载到/mnt/agents/output/tools/ |
| 3 | 600秒命令超时 | Gradle首次构建需5-15分钟 | 使用nohup后台构建 + 分步检查进度 |
| 4 | Gradle daemon OOM崩溃 | 内存配置不当(2GB+newArch) | 降低内存到1GB，禁用newArch，只编译arm64 |
| 5 | JDK自动下载阻塞 | react-native-gradle-plugin的foojay resolver | 预禁用foojay插件 |
| 6 | node_modules复制超时 | 500MB+文件从/tmp复制到持久目录超时 | 用symlink或直接/tmp构建 |
| 7 | 大文件解压I/O错误 | 沙盒文件系统限制 | 使用流式解压，避免大文件操作 |

## 最终策略

**单命令链执行**：create-expo-app -> copy source -> prebuild -> start Gradle build in background
**GRADLE_USER_HOME持久化**：指向 /mnt/agents/output/gradle-cache（不被清理）
**nohup后台构建**：命令超时后daemon继续运行
**分步检查**：每次交互检查daemon状态和APK输出
