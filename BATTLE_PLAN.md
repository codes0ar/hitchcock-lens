# 终极APK构建方案 - 不达目的誓不休

## 所有已知障碍及攻克方案

| # | 障碍 | 攻克方案 |
|---|------|---------|
| 1 | JDK/javac缺失 | 分割下载JDK tar.gz到/tmp，解压到/tmp/jdk17 |
| 2 | /mnt/agents 100MB文件限制 | 所有大文件操作在/tmp完成 |
| 3 | 下载慢(29KB/s) | 后台下载 + 分片下载 + 耐心等待 |
| 4 | 600秒命令超时 | nohup后台 + 分步状态检查 |
| 5 | /tmp定期清理 | 关键产出立即复制到/mnt/agents/output |
| 6 | FUSE权限不可修改 | 只在/tmp执行需要权限的文件 |
| 7 | Gradle缓存不能在FUSE | GRADLE_USER_HOME=/tmp/gradle-cache |

## 执行阶段

阶段1: 下载JDK 17（分割方式，后台）
阶段2: 验证工具链完整性
阶段3: 重建项目 + Prebuild
阶段4: 后台Gradle构建
阶段5: 复制APK到持久化目录
