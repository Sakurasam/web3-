// Import required modules
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Create a readline interface for user input
 */
function createInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * Prompt the user for input
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - Question to ask the user
 * @returns {Promise<string>} - User's response
 */
function prompt(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

/**
 * Generate Ethereum wallets and save their details to a CSV file
 * @param {number} count - Number of wallets to generate
 */
async function generateWallets(count = 1) {
    const wallets = [];
    
    console.log(`正在生成 ${count} 个以太坊钱包...`);
    
    for (let i = 0; i < count; i++) {
        // Generate a random wallet with mnemonic
        const wallet = ethers.Wallet.createRandom();
        
        // Extract wallet information
        const address = wallet.address;
        const privateKey = wallet.privateKey;
        const mnemonic = wallet.mnemonic.phrase;
        
        // Store wallet information
        wallets.push({
            address,
            privateKey,
            mnemonic
        });
        
        console.log(`钱包 ${i+1} 已生成: ${address}`);
    }
    
    // Save wallets to a CSV file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(__dirname, `钱包-${timestamp}.csv`);
    
    // Create CSV header and content
    let csvContent = '序号,钱包地址,私钥,助记词\n';
    wallets.forEach((wallet, index) => {
        csvContent += `${index + 1},"${wallet.address}","${wallet.privateKey}","${wallet.mnemonic}"\n`;
    });
    
    fs.writeFileSync(outputFile, csvContent);
    console.log(`钱包信息已保存至: ${outputFile}`);
    
    return wallets;
}

/**
 * Main function to run the wallet generator
 */
async function main() {
    const rl = createInterface();
    
    try {
        // Ask user for number of wallets to generate
        const countInput = await prompt(rl, '您想要生成多少个钱包？ ');
        const count = parseInt(countInput.trim());
        
        if (isNaN(count) || count <= 0) {
            console.error('请输入一个有效的正整数。');
            return;
        }
        
        // Generate wallets
        await generateWallets(count);
    } catch (error) {
        console.error('生成钱包时出错:', error);
    } finally {
        rl.close();
    }
}

// Run the main function
main();
