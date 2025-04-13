// 导入所需模块
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 合约地址
const CONTRACT_ADDRESS = '0xa18f6FCB2Fd4884436d10610E69DB7BFa1bFe8C7';

// 重试配置
const MAX_RETRIES = 10;        // 最大重试次数
const RETRY_DELAY = 0;         // 重试间隔(毫秒)，设为0表示立即重试
const ESCALATION_FACTOR = 1;   // 重试间隔递增因子，设为1表示不递增

// 随机暂停配置
const MIN_PAUSE = 10;          // 最小暂停时间(秒)
const MAX_PAUSE = 60;          // 最大暂停时间(秒)

// 默认文件路径
const DEFAULT_PRIVATE_KEY_FILE = '../pk.txt';
const DEFAULT_PROXY_FILE = 'proxies.txt';
const DEFAULT_ABI_FILE = 'abi.json';

// 持续运行配置
const DAILY_CHECK_INTERVAL = 1; // 每隔多少小时检查一次是否可以领取
const HOURS_TO_WAIT_AFTER_CLAIM = 23; // 成功领取后等待多少小时再检查

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
 * 检查钱包是否已经领取过奖励
 * @param {ethers.Contract} contract - 合约实例
 * @param {string} walletAddress - 钱包地址
 * @returns {Promise<boolean>} - 是否已领取
 */
async function hasClaimedToday(contract, walletAddress) {
    try {
        const dailyRewards = await contract.dailyRewardsAvailable(walletAddress);
        const dailyRewardsEth = ethers.formatEther(dailyRewards);
        
        if (dailyRewardsEth === '0.0') {
            return true; // 没有可领取的奖励，表示已经领取过
        }
        
        return false; // 有可领取的奖励，表示今天还没有领取
    } catch (error) {
        console.log(`检查领取状态失败: ${error.message}`);
        return false; // 出错时假设还没有领取
    }
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
            const claimed = await hasClaimedToday(contract, walletAddress);
            if (claimed) {
                console.log('今天已经领取过奖励，跳过此钱包');
                return true;
            }
            
            // 获取可领取的奖励数量
            const dailyRewards = await contract.dailyRewardsAvailable(walletAddress);
            const dailyRewardsEth = ethers.formatEther(dailyRewards);
            console.log(`可领取的每日奖励: ${dailyRewardsEth} HUM`);
            
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
            
            // 如果有延迟，则等待
            if (RETRY_DELAY > 0) {
                console.log(`将在 ${RETRY_DELAY/1000} 秒后重试...`);
                await delay(RETRY_DELAY);
            } else {
                console.log(`立即重试...`);
            }
        }
    }
    
    return false;
}

/**
 * 执行一轮签到
 * @param {Array<string>} privateKeys - 私钥数组
 * @param {Array<string>} proxies - 代理数组
 * @param {string} rpcUrl - RPC URL
 * @param {Array} contractABI - 合约ABI
 * @returns {Object} - 签到结果统计
 */
async function runClaimCycle(privateKeys, proxies, rpcUrl, contractABI) {
    // 随机打乱私钥顺序
    const shuffledKeys = shuffleArray(privateKeys);
    
    // 记录开始时间
    const startTime = new Date();
    console.log(`\n===== 开始新一轮签到 =====`);
    console.log(`开始时间: ${startTime.toLocaleString()}`);
    
    // 记录成功和失败的钱包数
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    
    // 遍历所有钱包进行签到
    for (let i = 0; i < shuffledKeys.length; i++) {
        const privateKey = shuffledKeys[i];
        
        // 选择代理（如果有）
        const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
        
        // 执行签到
        const success = await claimReward(privateKey, rpcUrl, contractABI, proxy, i, shuffledKeys.length);
        
        if (success) {
            // 检查是否已经领取过
            const wallet = new ethers.Wallet(privateKey);
            const provider = createProvider(rpcUrl, proxy);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, provider);
            const claimed = await hasClaimedToday(contract, wallet.address);
            
            if (claimed) {
                skippedCount++;
            } else {
                successCount++;
            }
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
    
    console.log('\n===== 本轮签到完成 =====');
    console.log(`开始时间: ${startTime.toLocaleString()}`);
    console.log(`结束时间: ${endTime.toLocaleString()}`);
    console.log(`总耗时: ${durationMinutes} 分钟`);
    console.log(`总钱包数: ${shuffledKeys.length}`);
    console.log(`成功: ${successCount}`);
    console.log(`跳过(已领取): ${skippedCount}`);
    console.log(`失败: ${failCount}`);
    
    return {
        successCount,
        skippedCount,
        failCount,
        totalWallets: shuffledKeys.length,
        startTime,
        endTime,
        durationMinutes
    };
}

/**
 * 计算下一次签到的时间
 * @param {Object} lastRunStats - 上一次运行的统计信息
 * @returns {Date} - 下一次签到的时间
 */
function calculateNextRunTime(lastRunStats) {
    const now = new Date();
    
    if (lastRunStats.successCount > 0) {
        // 如果有成功领取的钱包，等待HOURS_TO_WAIT_AFTER_CLAIM小时后再次运行
        const nextRun = new Date(now);
        nextRun.setHours(nextRun.getHours() + HOURS_TO_WAIT_AFTER_CLAIM);
        return nextRun;
    } else {
        // 如果没有成功领取的钱包，等待DAILY_CHECK_INTERVAL小时后再次检查
        const nextRun = new Date(now);
        nextRun.setHours(nextRun.getHours() + DAILY_CHECK_INTERVAL);
        return nextRun;
    }
}

/**
 * 主函数
 */
async function main() {
    try {
        console.log('===== 多钱包签到脚本 =====');
        
        // 读取命令行参数
        const args = process.argv.slice(2);
        const rpcUrl = args[0] || 'https://rpc.testnet.humanity.org'; // 默认RPC URL
        
        // 使用默认私钥文件路径
        const privateKeyFile = DEFAULT_PRIVATE_KEY_FILE;
        console.log(`使用私钥文件: ${privateKeyFile}`);
        
        // 使用默认代理文件路径
        const proxyFile = DEFAULT_PROXY_FILE;
        console.log(`使用代理文件: ${proxyFile}`);
        
        // 读取合约ABI
        const abiPath = path.join(__dirname, DEFAULT_ABI_FILE);
        const contractABI = readContractABI(abiPath);
        
        // 读取私钥列表
        const privateKeys = readPrivateKeys(path.resolve(__dirname, privateKeyFile));
        console.log(`成功读取 ${privateKeys.length} 个私钥`);
        
        // 读取代理列表
        const proxies = readProxies(path.resolve(__dirname, proxyFile));
        if (proxies.length > 0) {
            console.log(`成功读取 ${proxies.length} 个代理`);
        }
        
        console.log('准备开始批量签到...');
        console.log(`使用RPC: ${rpcUrl}`);
        console.log(`将随机暂停 ${MIN_PAUSE}-${MAX_PAUSE} 秒之间的时间`);
        console.log(`持续运行模式已启动: 每${DAILY_CHECK_INTERVAL}小时检查一次，成功领取后等待${HOURS_TO_WAIT_AFTER_CLAIM}小时`);
        
        // 持续运行模式
        let continuousMode = true;
        let lastRunStats = null;
        
        while (continuousMode) {
            // 执行一轮签到
            lastRunStats = await runClaimCycle(privateKeys, proxies, rpcUrl, contractABI);
            
            // 计算下一次运行时间
            const nextRunTime = calculateNextRunTime(lastRunStats);
            const waitTimeMs = nextRunTime.getTime() - new Date().getTime();
            const waitTimeHours = Math.round(waitTimeMs / 3600000 * 10) / 10;
            
            console.log(`\n下一次签到将在 ${nextRunTime.toLocaleString()} 进行 (约${waitTimeHours}小时后)`);
            
            // 等待到下一次运行时间
            await delay(waitTimeMs);
        }
        
    } catch (error) {
        console.error(`错误: ${error.message}`);
    }
}

// 运行主函数
main();
