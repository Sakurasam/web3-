// 导入所需模块
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 合约地址
const CONTRACT_ADDRESS = '0xa18f6FCB2Fd4884436d10610E69DB7BFa1bFe8C7';

// 重试配置
const MAX_RETRIES = 5;         // 最大重试次数
const RETRY_DELAY = 5000;      // 重试间隔(毫秒)
const ESCALATION_FACTOR = 1.5; // 重试间隔递增因子

// 随机暂停配置
const MIN_PAUSE = 30;          // 最小暂停时间(秒)
const MAX_PAUSE = 180;         // 最大暂停时间(秒)

/**
 * 创建用户输入接口
 */
function createInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * 提示用户输入
 * @param {readline.Interface} rl - Readline接口
 * @param {string} question - 问题
 * @returns {Promise<string>} - 用户的回答
 */
function prompt(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise} - 延迟Promise
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成随机数
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} - 随机数
 */
function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 随机打乱数组
 * @param {Array} array - 要打乱的数组
 * @returns {Array} - 打乱后的数组
 */
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

/**
 * 从文件中读取私钥列表
 * @param {string} filePath - 私钥文件路径
 * @returns {Array<string>} - 私钥数组
 */
function readPrivateKeys(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        // 按行分割，移除空行和空白
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    } catch (error) {
        throw new Error(`读取私钥文件失败: ${error.message}`);
    }
}

/**
 * 从文件中读取代理列表
 * @param {string} filePath - 代理文件路径
 * @returns {Array<string>} - 代理数组
 */
function readProxies(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.log(`代理文件 ${filePath} 不存在，将不使用代理`);
            return [];
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        // 按行分割，移除空行和空白
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    } catch (error) {
        console.error(`读取代理文件失败: ${error.message}`);
        return [];
    }
}

/**
 * 从文件中读取合约ABI
 * @param {string} filePath - ABI文件路径
 * @returns {Array} - 合约ABI
 */
function readContractABI(filePath) {
    try {
        const abiData = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(abiData);
    } catch (error) {
        throw new Error(`读取合约ABI文件失败: ${error.message}`);
    }
}

/**
 * 创建带有代理的提供者
 * @param {string} rpcUrl - RPC URL
 * @param {string|null} proxy - 代理URL
 * @returns {ethers.JsonRpcProvider} - 提供者
 */
function createProvider(rpcUrl, proxy) {
    if (!proxy) {
        return new ethers.JsonRpcProvider(rpcUrl);
    }
    
    // 创建带有代理的提供者
    const agent = new HttpsProxyAgent(proxy);
    const fetchOptions = {
        agent: agent
    };
    
    return new ethers.JsonRpcProvider(rpcUrl, undefined, {
        fetchOptions: fetchOptions
    });
}

/**
 * 执行合约签到
 * @param {string} privateKey - 钱包私钥
 * @param {string} rpcUrl - RPC URL
 * @param {Array} contractABI - 合约ABI
 * @param {string|null} proxy - 代理URL
 * @param {number} walletIndex - 钱包索引
 * @param {number} totalWallets - 总钱包数
 * @returns {boolean} - 是否成功
 */
async function claimReward(privateKey, rpcUrl, contractABI, proxy, walletIndex, totalWallets) {
    let retryCount = 0;
    let currentDelay = RETRY_DELAY;
    
    while (retryCount <= MAX_RETRIES) {
        try {
            if (retryCount > 0) {
                console.log(`尝试第 ${retryCount} 次重试...`);
            }
            
            // 连接到提供的RPC，可能使用代理
            const provider = createProvider(rpcUrl, proxy);
            
            // 创建钱包实例
            const wallet = new ethers.Wallet(privateKey, provider);
            const walletAddress = wallet.address;
            
            console.log(`[钱包 ${walletIndex+1}/${totalWallets}] 地址: ${walletAddress}`);
            if (proxy) {
                console.log(`使用代理: ${proxy}`);
            }
            
            // 创建合约实例
            const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);
            
            // 检查是否有可领取的奖励
            try {
                const dailyRewards = await contract.dailyRewardsAvailable(walletAddress);
                const dailyRewardsEth = ethers.formatEther(dailyRewards);
                console.log(`可领取的每日奖励: ${dailyRewardsEth} HUM`);
                
                // 如果没有奖励可领取，则跳过
                if (dailyRewardsEth === '0.0') {
                    console.log('没有可领取的奖励，跳过此钱包');
                    return true;
                }
            } catch (error) {
                console.log('无法查询可领取的奖励，继续尝试签到...');
            }
            
            // 获取当前gas价格
            const feeData = await provider.getFeeData();
            
            console.log('正在执行签到操作...');
            
            // 调用合约的claimReward函数
            const tx = await contract.claimReward({
                gasLimit: 300000, // 设置足够的gas限制
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
            });
            
            console.log(`交易已发送，交易哈希: ${tx.hash}`);
            console.log('等待交易确认...');
            
            // 等待交易确认
            const receipt = await tx.wait();
            
            console.log(`签到成功! 区块号: ${receipt.blockNumber}`);
            
            // 检查交易事件
            const rewardClaimedEvents = receipt.logs
                .filter(log => {
                    try {
                        const parsedLog = contract.interface.parseLog(log);
                        return parsedLog && parsedLog.name === 'RewardClaimed';
                    } catch (e) {
                        return false;
                    }
                })
                .map(log => {
                    const parsedLog = contract.interface.parseLog(log);
                    return {
                        user: parsedLog.args.user,
                        rewardType: parsedLog.args.rewardType,
                        amount: parsedLog.args.amount
                    };
                });
                
            if (rewardClaimedEvents.length > 0) {
                const event = rewardClaimedEvents[0];
                console.log(`领取的奖励: ${ethers.formatEther(event.amount)} HUM`);
            }
            
            // 保存签到记录
            const timestamp = new Date().toISOString();
            const logEntry = `${timestamp} - 钱包 ${walletIndex+1}/${totalWallets} - 地址: ${walletAddress} - 交易哈希: ${receipt.hash}\n`;
            
            fs.appendFileSync(path.join(__dirname, 'claim_log.txt'), logEntry);
            console.log('签到记录已保存');
            
            // 签到成功，返回true
            return true;
            
        } catch (error) {
            // 记录当前错误
            console.error(`签到失败: ${error.message}`);
            
            // 检查是否已达到最大重试次数
            if (retryCount >= MAX_RETRIES) {
                console.error(`已达到最大重试次数 (${MAX_RETRIES})，停止尝试`);
                
                // 保存错误记录
                const timestamp = new Date().toISOString();
                const errorEntry = `${timestamp} - 钱包 ${walletIndex+1}/${totalWallets} - 错误: ${error.message} - 已重试${retryCount}次后失败\n`;
                
                fs.appendFileSync(path.join(__dirname, 'claim_error_log.txt'), errorEntry);
                return false;
            }
            
            // 增加重试计数
            retryCount++;
            
            // 计算下一次重试的延迟时间（指数退避策略）
            console.log(`将在 ${currentDelay/1000} 秒后重试...`);
            await delay(currentDelay);
            currentDelay = Math.floor(currentDelay * ESCALATION_FACTOR);
        }
    }
    
    return false;
}

/**
 * 主函数
 */
async function main() {
    const rl = createInterface();
    
    try {
        console.log('===== 多钱包签到脚本 =====');
        
        // 读取命令行参数
        const args = process.argv.slice(2);
        const rpcUrl = args[0] || 'https://rpc.testnet.humanity.org'; // 默认RPC URL
        
        // 获取私钥文件路径
        const privateKeyFile = await prompt(rl, '请输入私钥文件路径 (默认: ../pk.txt): ') || '../pk.txt';
        
        // 获取代理文件路径
        const proxyFile = await prompt(rl, '请输入代理文件路径 (如不使用代理请留空): ');
        
        // 读取合约ABI
        const abiPath = path.join(__dirname, 'abi.json');
        const contractABI = readContractABI(abiPath);
        
        // 读取私钥列表
        const privateKeys = readPrivateKeys(path.resolve(__dirname, privateKeyFile));
        console.log(`成功读取 ${privateKeys.length} 个私钥`);
        
        // 读取代理列表
        const proxies = proxyFile ? readProxies(path.resolve(__dirname, proxyFile)) : [];
        if (proxies.length > 0) {
            console.log(`成功读取 ${proxies.length} 个代理`);
        }
        
        // 随机打乱私钥顺序
        const shuffledKeys = shuffleArray(privateKeys);
        
        console.log('准备开始批量签到...');
        console.log(`使用RPC: ${rpcUrl}`);
        console.log(`将随机暂停 ${MIN_PAUSE}-${MAX_PAUSE} 秒之间的时间`);
        
        // 确认是否继续
        const confirm = await prompt(rl, '是否继续批量签到? (y/n): ');
        if (confirm.toLowerCase() !== 'y') {
            console.log('已取消批量签到');
            return;
        }
        
        // 记录开始时间
        const startTime = new Date();
        console.log(`开始时间: ${startTime.toLocaleString()}`);
        
        // 记录成功和失败的钱包数
        let successCount = 0;
        let failCount = 0;
        
        // 遍历所有钱包进行签到
        for (let i = 0; i < shuffledKeys.length; i++) {
            const privateKey = shuffledKeys[i];
            
            // 选择代理（如果有）
            const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
            
            // 执行签到
            const success = await claimReward(privateKey, rpcUrl, contractABI, proxy, i, shuffledKeys.length);
            
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
            
            // 如果不是最后一个钱包，则随机暂停
            if (i < shuffledKeys.length - 1) {
                const pauseSeconds = getRandomNumber(MIN_PAUSE, MAX_PAUSE);
                console.log(`\n随机暂停 ${pauseSeconds} 秒后继续下一个钱包...\n`);
                await delay(pauseSeconds * 1000);
            }
        }
        
        // 记录结束时间
        const endTime = new Date();
        const durationMinutes = Math.round((endTime - startTime) / 60000);
        
        console.log('\n===== 批量签到完成 =====');
        console.log(`开始时间: ${startTime.toLocaleString()}`);
        console.log(`结束时间: ${endTime.toLocaleString()}`);
        console.log(`总耗时: ${durationMinutes} 分钟`);
        console.log(`总钱包数: ${shuffledKeys.length}`);
        console.log(`成功: ${successCount}`);
        console.log(`失败: ${failCount}`);
        
    } catch (error) {
        console.error(`错误: ${error.message}`);
    } finally {
        rl.close();
    }
}

// 运行主函数
main();
