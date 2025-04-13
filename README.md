# Web3工具集

这个仓库包含了一系列用于以太坊和其他EVM兼容链的实用工具脚本。

## 功能列表

1. **钱包生成工具** - `generateWallet.js`
   - 生成以太坊钱包地址、私钥和助记词
   - 支持批量生成
   - 保存为CSV格式

2. **批量转账工具** - `batchTransfer.js`
   - 从一个钱包向多个地址批量转账
   - 支持自定义RPC和转账金额
   - 交易结果记录和错误处理

3. **签到工具** - `hum/clam.js`
   - 调用合约的claimReward函数
   - 自动重试机制
   - 交易日志记录

4. **多钱包签到工具** - `hum/multiWalletClaim.js`
   - 支持多钱包随机顺序签到
   - 随机暂停时间，避免女巫风险
   - 支持HTTP代理，避免IP限制
   - 详细的日志记录

## 安装

```bash
# 克隆仓库
git clone https://github.com/你的用户名/web3-tools.git
cd web3-tools

# 安装依赖
npm install
```

## 使用方法

### 钱包生成

```bash
node generateWallet.js
```

### 批量转账

```bash
node batchTransfer.js
```

### 合约签到

```bash
node hum/clam.js
```

### 多钱包签到

```bash
node hum/multiWalletClaim.js
```

## 配置文件

1. **私钥文件** - `pk.txt`
   - 每行一个私钥

2. **代理文件** - `proxies.txt`
   - 每行一个代理地址
   - 格式: `http://用户名:密码@代理地址:端口`

3. **ABI文件** - `hum/abi.json`
   - 合约ABI定义

## 注意事项

- 请妥善保管您的私钥，不要分享给他人
- 使用前请确保了解脚本的功能和风险
- 本工具仅供学习和研究使用

## 许可证

MIT
