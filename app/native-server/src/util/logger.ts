import { stderr } from 'process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 设置日志文件路径 - 使用用户临时目录
const LOG_DIR = path.join(os.tmpdir(), 'chrome-mcp-server-logs');
const LOG_FILE = path.join(
  LOG_DIR,
  `native-host-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
);

// 确保日志目录存在
let logFileReady = false;
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  logFileReady = true;
} catch (err) {
  stderr.write(`[ERROR] 创建日志目录失败: ${err}\n`);
}

// 日志函数
function writeLog(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;

  // 写入到文件
  if (logFileReady) {
    try {
      fs.appendFileSync(LOG_FILE, logMessage);
    } catch (err) {
      stderr.write(`[ERROR] 写入日志失败: ${err}\n`);
    }
  }

  // 同时输出到stderr（不影响native messaging协议）
  stderr.write(logMessage);
}

// 日志级别函数
export const logger = {
  debug: (message: string) => writeLog('DEBUG', message),
  info: (message: string) => writeLog('INFO', message),
  warn: (message: string) => writeLog('WARN', message),
  error: (message: string) => writeLog('ERROR', message),
  getLogFile: () => LOG_FILE,
  getLogDir: () => LOG_DIR,
};
