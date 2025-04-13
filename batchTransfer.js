// 导入所需模块
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const csv = require('csv-parser');

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
 * 从文件中读取私钥
 * @param {string} filePath - 私钥文件路径
 * @returns {Promise<string>} - 私钥
 */
async function readPrivateKey(filePath) {
    try {
        const privateKey = fs.readFileSync(filePath, 'utf8').trim();
        return privateKey;
    } catch (error) {
        throw new Error(`读取私钥文件失败: ${error.message}`);
    }
}

/**
 * 从CSV文件中读取钱包地址
 * @param {string} filePath - CSV文件路径
 * @returns {Promise<string[]>} - 钱包地址数组
 */
async function readWalletAddresses(filePath) {
    return new Promise((resolve, reject) => {
        const addresses = [];
        
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                // 尝试从不同可能的列名中获取地址
                const address = row['钱包地址'] || row['地址'] || row['Address'] || row['address'];
                if (address) {
                    addresses.push(address);
                }
            })
            .on('end', () => {
                if (addresses.length === 0) {
                    reject(new Error('CSV文件中未找到任何钱包地址'));
                } else {
                    resolve(addresses);
                }
            })
            .on('error', (error) => {
                reject(new Error(`读取CSV文件失败: ${error.message}`));
            });
    });
}

/**
 * 批量转账
 * @param {string} privateKey - 发送方私钥
 * @param {string[]} toAddresses - 接收方地址数组
 * @param {string} rpcUrl - RPC URL
 * @param {string} amount - 转账金额(ETH)
 */
async function batchTransfer(privateKey, toAddresses, rpcUrl, amount) {
    try {
        // 连接到提供的RPC
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        
        // 创建钱包实例
        const wallet = new ethers.Wallet(privateKey, provider);
        const fromAddress = wallet.address;
        
        console.log(`发送方钱包地址: ${fromAddress}`);
        
        // 获取当前余额
        const balance = await provider.getBalance(fromAddress);
        const balanceInEth = ethers.formatEther(balance);
        console.log(`当前余额: ${balanceInEth} ETH`);
        
        // 计算总共需要的ETH
        const amountInWei = ethers.parseEther(amount);
        const totalRequired = amountInWei * BigInt(toAddresses.length);
        const totalRequiredEth = ethers.formatEther(totalRequired);
        
        console.log(`接收方地址数量: ${toAddresses.length}`);
        console.log(`每个地址将收到: ${amount} ETH`);
        console.log(`总共需要: ${totalRequiredEth} ETH`);
        
        // 检查余额是否足够
        if (balance < totalRequired) {
            throw new Error(`余额不足，需要至少 ${totalRequiredEth} ETH，但当前只有 ${balanceInEth} ETH`);
        }
        
        // 获取当前gas价格
        const feeData = await provider.getFeeData();
        
        // 执行转账
        console.log('\n开始批量转账...');
        
        const txPromises = toAddresses.map(async (toAddress, index) => {
            try {
                console.log(`[${index + 1}/${toAddresses.length}] 正在转账 ${amount} ETH 到 ${toAddress}...`);
                
                // 创建交易
                const tx = await wallet.sendTransaction({
                    to: toAddress,
                    value: amountInWei,
                    gasLimit: 21000, // 标准ETH转账的gas限制
                    maxFeePerGas: feeData.maxFeePerGas,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
                });
                
                // 等待交易确认
                const receipt = await tx.wait();
                
                console.log(`[${index + 1}/${toAddresses.length}] 转账成功! 交易哈希: ${receipt.hash}`);
                return {
                    success: true,
                    toAddress,
                    txHash: receipt.hash
                };
            } catch (error) {
                console.error(`[${index + 1}/${toAddresses.length}] 转账到 ${toAddress} 失败: ${error.message}`);
                return {
                    success: false,
                    toAddress,
                    error: error.message
                };
            }
        });
        
        // 等待所有交易完成
        const results = await Promise.all(txPromises);
        
        // 统计结果
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log('\n批量转账完成!');
        console.log(`成功: ${successful}/${toAddresses.length}`);
        console.log(`失败: ${failed}/${toAddresses.length}`);
        
        // 保存交易结果到文件
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultFile = path.join(__dirname, `转账结果-${timestamp}.csv`);
        
        let csvContent = '序号,接收地址,状态,交易哈希/错误信息\n';
        results.forEach((result, index) => {
            const status = result.success ? '成功' : '失败';
            const hashOrError = result.success ? result.txHash : result.error;
            csvContent += `${index + 1},"${result.toAddress}","${status}","${hashOrError}"\n`;
        });
        
        fs.writeFileSync(resultFile, csvContent);
        console.log(`转账结果已保存至: ${resultFile}`);
        
    } catch (error) {
        console.error(`批量转账过程中出错: ${error.message}`);
    }
}

/**
 * 主函数
 */
async function main() {
    const rl = createInterface();
    
    try {
        // 1. 获取私钥文件路径
        const privateKeyFile = await prompt(rl, '请输入私钥文件路径 (默认: pk.txt): ') || 'pk.txt';
        
        // 2. 获取钱包地址CSV文件路径
        const walletCsvFile = await prompt(rl, '请输入钱包地址CSV文件路径 (默认: wallet.csv): ') || 'wallet.csv';
        
        // 3. 获取RPC URL
        const rpcUrl = await prompt(rl, '请输入RPC URL: ');
        if (!rpcUrl) {
            throw new Error('RPC URL不能为空');
        }
        
        // 4. 获取转账金额
        const amount = await prompt(rl, '请输入每个地址的转账金额(ETH): ');
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            throw new Error('请输入有效的转账金额');
        }
        
        // 读取私钥
        const privateKey = await readPrivateKey(privateKeyFile);
        console.log('私钥读取成功');
        
        // 读取钱包地址
        const addresses = await readWalletAddresses(walletCsvFile);
        console.log(`从CSV文件中读取了 ${addresses.length} 个接收地址`);
        
        // 确认是否继续
        const confirm = await prompt(rl, '是否继续批量转账? (y/n): ');
        if (confirm.toLowerCase() !== 'y') {
            console.log('已取消批量转账');
            return;
        }
        
        // 执行批量转账
        await batchTransfer(privateKey, addresses, rpcUrl, amount);
        
    } catch (error) {
        console.error(`错误: ${error.message}`);
    } finally {
        rl.close();
    }
}

// 运行主函数
main();
