const API_KEY = "an42pvudchw2pmb5dd7katj8agt6rnkgen6mrvbbd11mutkj8h7nenkna1p7awb9dcvk4gtgeh3pgm219d47mjjr8grm8bvk64v7mnuu69tq4cu28dtpmjvbet14uxtfdxgnjnjaa4yku6t0q6kjnb0qjpbun9h5pprkn5we1gpchah8gnqavvqa97k4hbacmnk8du3718kuf8";
const PUBLIC_KEY = "9HFM42ne6XzjpuViFm1gLbo7gxs32B2ktSBWGHhULxSt";

import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';

async function getWalletTokensInfo() {
  const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
  const publicKey = new PublicKey(PUBLIC_KEY);

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  });

  let tokens = [];
  tokenAccounts.value.forEach((account) => {
    const info = account.account.data.parsed.info;
    tokens.push({ mint: info.mint, tokenAmount: info.tokenAmount.uiAmount });
  });

  return tokens;
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkWalletBalance() {
  const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
  const publicKey = new PublicKey(PUBLIC_KEY);
  const balance = await connection.getBalance(publicKey);
  console.log("Wallet balance in SOL:", balance / LAMPORTS_PER_SOL);
}

async function checkTransactionStatus(signature) {
  // Connect to the Solana mainnet (or devnet/testnet if needed)
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  // Get the transaction status
  const status = await connection.getSignatureStatus(signature);
  const transaction = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0 // Adjust based on your needs
  });

  if (status.value && status.value.err === null) {
    return true;
  } else {
    if (status.value) {
      console.log('[ ⚠️ TRANSACTION_FAILED ] signature: ', signature, ' error: ', status.value.err);
      return false;
    } else {
      console.log('--> transaction not found, trying again! signature: ', signature);
      await sleep(1000);
      return await checkTransactionStatus(signature);
    }
  }
}


async function sendPos(action = 'buy', mint, amount, denominatedInSol = true, slippage, priorityFee) {
  const payload = {
    "action": action,
    "mint": mint,
    "amount": amount,
    "denominatedInSol": denominatedInSol.toString(),
    "slippage": slippage,
    "priorityFee": priorityFee,
    "pool": "pump",
  };

  const response = await fetch(`https://pumpportal.fun/api/trade?api-key=${API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  console.log('[ 🚀 SEND_TRANSACTION ] payload: ', payload);

  if (data && data.signature) {
    await sleep(4000);
    if (await checkTransactionStatus(data.signature))
      return data.signature;
    throw '';
  }
  else throw `[ 🚫 TRANSACTION_FAILED ] PUMPFUN_FAILED: payload: ${JSON.stringify(payload)} \nresponse: ${JSON.stringify(data)}`;
}

async function main() {

  await checkWalletBalance();
  const tokens = await getWalletTokensInfo('9HFM42ne6XzjpuViFm1gLbo7gxs32B2ktSBWGHhULxSt');
  console.log('remained tokens: ', tokens.filter((token) => (token.tokenAmount > 0)).length);
  for (const token of tokens) {
    if (token.tokenAmount <= 0)
      continue;
    await sendPos(
      'sell',
      token.mint,
      '100%',
      true,
      2,
      0.000005,
    );
    await checkWalletBalance();
  }
}

main();