// 导入所需模块
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// 合约地址
const CONTRACT_ADDRESS = '0xa18f6FCB2Fd4884436d10610E69DB7BFa1bFe8C7';

// 重试配置
const MAX_RETRIES = 5;         // 最大重试次数
const RETRY_DELAY = 5000;      // 重试间隔(毫秒)
const ESCALATION_FACTOR = 1.5; // 重试间隔递增因子

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise} - 延迟Promise
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从文件中读取私钥
 * @param {string} filePath - 私钥文件路径
 * @returns {string} - 私钥
 */
function readPrivateKey(filePath) {
    try {
        const privateKey = fs.readFileSync(filePath, 'utf8').trim();
        return privateKey;
    } catch (error) {
        throw new Error(`读取私钥文件失败: ${error.message}`);
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
 * 执行合约签到
 * @param {string} privateKey - 钱包私钥
 * @param {string} rpcUrl - RPC URL
 * @param {Array} contractABI - 合约ABI
 */
async function claimReward(privateKey, rpcUrl, contractABI) {
    let retryCount = 0;
    let currentDelay = RETRY_DELAY;
    
    while (retryCount <= MAX_RETRIES) {
        try {
            if (retryCount > 0) {
                console.log(`尝试第 ${retryCount} 次重试...`);
            }
            
            // 连接到提供的RPC
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            
            // 创建钱包实例
            const wallet = new ethers.Wallet(privateKey, provider);
            const walletAddress = wallet.address;
            
            console.log(`钱包地址: ${walletAddress}`);
            
            // 创建合约实例
            const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);
            
            // 检查是否有可领取的奖励
            try {
                const dailyRewards = await contract.dailyRewardsAvailable(walletAddress);
                const dailyRewardsEth = ethers.formatEther(dailyRewards);
                console.log(`可领取的每日奖励: ${dailyRewardsEth} HUM`);
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
            const logEntry = `${timestamp} - 地址: ${walletAddress} - 交易哈希: ${receipt.hash}\n`;
            
            fs.appendFileSync(path.join(__dirname, 'claim_log.txt'), logEntry);
            console.log('签到记录已保存');
            
            // 签到成功，退出重试循环
            return;
            
        } catch (error) {
            // 记录当前错误
            console.error(`签到失败: ${error.message}`);
            
            // 检查是否已达到最大重试次数
            if (retryCount >= MAX_RETRIES) {
                console.error(`已达到最大重试次数 (${MAX_RETRIES})，停止尝试`);
                
                // 保存错误记录
                const timestamp = new Date().toISOString();
                const errorEntry = `${timestamp} - 错误: ${error.message} - 已重试${retryCount}次后失败\n`;
                
                fs.appendFileSync(path.join(__dirname, 'claim_error_log.txt'), errorEntry);
                break;
            }
            
            // 增加重试计数
            retryCount++;
            
            // 计算下一次重试的延迟时间（指数退避策略）
            console.log(`将在 ${currentDelay/1000} 秒后重试...`);
            await delay(currentDelay);
            currentDelay = Math.floor(currentDelay * ESCALATION_FACTOR);
        }
    }
}

/**
 * 主函数
 */
async function main() {
    try {
        // 读取命令行参数
        const args = process.argv.slice(2);
        const rpcUrl = args[0] || 'https://rpc.testnet.humanity.org'; // 默认RPC URL
        
        // 读取私钥
        const privateKeyPath = path.join(__dirname, '..', 'pk.txt');
        const privateKey = readPrivateKey(privateKeyPath);
        
        // 读取合约ABI
        const abiPath = path.join(__dirname, 'abi.json');
        const contractABI = readContractABI(abiPath);
        
        console.log('准备执行签到...');
        console.log(`使用RPC: ${rpcUrl}`);
        
        // 执行签到
        await claimReward(privateKey, rpcUrl, contractABI);
        
    } catch (error) {
        console.error(`错误: ${error.message}`);
    }
}

// 运行主函数
main();
