const API_KEY = "an42pvudchw2pmb5dd7katj8agt6rnkgen6mrvbbd11mutkj8h7nenkna1p7awb9dcvk4gtgeh3pgm219d47mjjr8grm8bvk64v7mnuu69tq4cu28dtpmjvbet14uxtfdxgnjnjaa4yku6t0q6kjnb0qjpbun9h5pprkn5we1gpchah8gnqavvqa97k4hbacmnk8du3718kuf8";
const PUBLIC_KEY = "9HFM42ne6XzjpuViFm1gLbo7gxs32B2ktSBWGHhULxSt";
const MaxTokenRemainTime = 60 * 10; // seconds
const MaxOpenPositions = 5;
const JsonFiles = {
  contracts: 'contractsData.json',
  strategies: 'strategiesData.json',
};

import { writeFileSync } from 'fs';
import WebSocket from 'ws';
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import express from 'express';
import cors from 'cors';

const contracts = {}, strategies = {}, fee = 0.000005;

const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

async function sleep(ms) {
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });

  return;
}

function getNowDateSecond() { return Math.floor(Date.now() / 1000); }

async function checkWalletBalance() {
  const publicKey = new PublicKey(PUBLIC_KEY);
  const balance = await connection.getBalance(publicKey);
  console.log("Wallet balance in SOL:", balance / LAMPORTS_PER_SOL);
}

async function checkTransactionStatus(signature) {
  // Get the transaction status
  const status = await connection.getSignatureStatus(signature);

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

async function getBuyTransactionCount(mint) {
  const mintPublicKey = new PublicKey(mint);
  const signatures = await connection.getSignaturesForAddress(mintPublicKey, { limit: 1000 });

  let buyTransactionCount = 0;

  for (const { signature } of signatures) {
    const transaction = await connection.getTransaction(signature, { commitment: "confirmed" });

    if (transaction && transaction.meta && transaction.meta.postTokenBalances.length > 0) {
      const preBalances = transaction.meta.preBalances;
      const postBalances = transaction.meta.postBalances;

      if (postBalances[0] > preBalances[0]) {
        buyTransactionCount++;
      }
    }
  }

  return buyTransactionCount;
}

class Transaction {

  config = {};
  createdAt = null;

  constructor(config) {
    this.setConfig(config);
    this.createdAt = getNowDateSecond();
  }

  setConfig(config) {
    this.config = config;
  }

  getMint() {
    return this.config.mint;
  }

  getPrice() {
    return this.config.vSolInBondingCurve / this.config.vTokensInBondingCurve;
  }

  getType() {
    return this.config.txType;
  }

  getProperty(key) {
    return this.config[key];
  }

}

class Contract {

  config = {};
  transactions = [];
  createdAt = null;

  constructor(transaction) {
    this.setConfig(transaction.config);
    this.addTransaction(transaction);
    this.createdAt = getNowDateSecond();
  }

  setConfig(config) {
    this.config = config;
  }

  addTransaction(trx) {
    this.transactions.push(trx);
  }

  getTransactions() {
    return this.transactions;
  }

  getLastTransaction() {
    return this.getTransactions()[this.getTransactions().length - 1];
  }

  getMint() {
    return this.config.mint;
  }

  getPrice() {
    return this.getLastTransaction().getProperty('vSolInBondingCurve') / this.getLastTransaction().getProperty('vTokensInBondingCurve');
  }

  getMarketCapSol() {
    return this.getLastTransaction().getProperty('marketCapSol');
  }

}

class PumpApi {

  ws = null;
  status = 'off';

  constructor() { }

  setStatus(status) {
    if (!['on', 'off'].includes(status))
      throw 'bot new status is not valid on pumpApi';
    this.status = status;
  }

  getStatus() {
    return this.status;
  }

  setupWebSocket() {
    this.ws = new WebSocket('wss://pumpportal.fun/api/data');

    this.ws.on('open', () => { this.handleWsOpen(); });
    this.ws.on('message', (json) => { this.handleWsUpdate(json); });
    this.ws.on('close', () => { this.handleWsClose(); });
  }

  handleWsSleep() {
    this.ws.send(JSON.stringify({ method: 'unsubscribeNewToken' }));
    this.ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: Object.values(contracts).map((contract) => (contract.getMint())) }));
    this.setStatus('off');
    for (const key of Object.keys(contracts)) {
      delete contracts[key];
    }
    console.log('[ PUMP ] ws Sleeped!');
  }

  handleWsWakeup() {
    this.ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    this.setStatus('on');
    console.log('[ PUMP ] ws Waked up!');
  }

  handleWsOpen() {
    console.log('[ PUMP ] pumpportal ws opened!');
    this.handleWsWakeup();
  }

  async handleWsUpdate(json) {
    const data = JSON.parse(json);
    if (data.txType) {
      const transaction = new Transaction(data);
      if (transaction.getType() == 'create') {
        contracts[transaction.getMint()] = new Contract(transaction);
        this.ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [transaction.getMint()] }));

        setTimeout(() => { // unsubscribe contract
          this.ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [transaction.getMint()] }));
          setTimeout(() => { // delete contract
            delete contracts[transaction.getMint()];
          }, MaxTokenRemainTime * 1000);
        }, MaxTokenRemainTime * 1000);

      }
      else contracts[transaction.getMint()].addTransaction(transaction);
    }
  }

  handleWsClose() {
    console.log('[ PUMP ] websocket connection closed!');
  }

}

class Position {

  status = 'inQueue';

  solAmount = null;
  mint = null;
  buySlippage = null;
  sellSlippage = null;
  priorityFee = null;

  openPrice = null;
  openSignature = null;

  closePrice = null;
  closeSignature = null;

  createdAt = null;

  constructor(solAmount, mint, buySlippage, sellSlippage) {
    this.solAmount = solAmount;
    this.mint = mint;
    this.buySlippage = buySlippage;
    this.sellSlippage = sellSlippage;

    this.createdAt = getNowDateSecond();
  }

  getMint() {
    return this.mint;
  }

  getStatus() {
    return this.status;
  }

  setStatus(status) {
    if (!['opening', 'open', 'closing', 'close', 'force-closing', 'force-close', 'inQueue', 'failed'].includes(status))
      throw 'invalid position status used in code!';
    this.status = status;
  }

  async sendPos(action = 'buy', amount, denominatedInSol = true, slippage) {
    const payload = {
      "action": action,
      "mint": this.mint,
      "amount": amount,
      "denominatedInSol": denominatedInSol.toString(),
      "slippage": slippage,
      "priorityFee": fee,
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
      await sleep(1000);
      if (await checkTransactionStatus(data.signature))
        return data.signature;
      throw '';
    }
    else throw `[ 🚫 TRANSACTION_FAILED ] PUMPFUN_FAILED: payload: ${JSON.stringify(payload)} \nresponse: ${JSON.stringify(data)}`;
  }

  async open() {
    if (this.getStatus() != 'inQueue')
      throw 'just inQueue position can be open';
    try {
      this.setStatus('opening');

      this.openSignature = await this.sendPos('buy', this.solAmount, true, this.buySlippage);
      this.openPrice = contracts[this.getMint()].getPrice() * ((100 + this.buySlippage) / 100); // calculate max price
      this.setStatus('open');
      console.log(`[ ✅ OPEN_POS ] mint: ${this.getMint()} signature: ${this.openSignature}`);
    } catch (e) {
      console.error(e);
      this.setStatus('failed');
    }
  }

  getOpenTokenAmount() {
    return this.solAmount / this.openPrice;
  }

  getResult() {
    return Math.floor(((contracts[this.getMint()].getPrice() - this.openPrice) / this.solAmount * 100) * 10) / 10;
  }

  async close() { // saved contract
    if (this.getStatus() != 'open')
      throw 'just open position can be closed!';
    try {
      this.setStatus('closing');

      this.closeSignature = await this.sendPos('sell', '100%', true, this.sellSlippage);
      this.closePrice = contracts[this.getMint()].getPrice() * ((100 - this.sellSlippage) / 100);
      this.setStatus('close');
      console.log(`[ 💳 CLOSE_POS ] result: [ sol: ${this.getSolResult()}, percent: ${this.getPercentResult()} ] mint: ${this.getMint()} signature: ${this.closeSignature}`);
    } catch (e) {
      console.error(e);
      this.setStatus('open');
    }
  }

  // sell in lower amount, but sell
  async forceClose() { // don't need saved contract
    if (this.getStatus() != 'open')
      throw 'just open position can be closed!';
    try {
      this.setStatus('force-closing');
      this.closePrice = this.openPrice;
      this.closeSignature = await this.sendPos('sell', '100%', false, this.sellSlippage);
      this.setStatus('force-close');
      console.log(`[ ⚠ FORCE_CLOSE_POS ] mint: ${this.getMint()} signature: ${this.closeSignature}`);
    } catch (e) {
      console.error(e);
      this.setStatus('open');
    }
  }

  getCloseSolAmount() {
    return this.closePrice * this.getOpenTokenAmount();
  }

  getSolResult() {
    return this.getCloseSolAmount() - this.solAmount;
  }

  getPercentResult() {
    return this.getSolResult() / this.solAmount * 100;
  }
}

class Strategy {

  isActive = false;
  positions = [];

  name = '';
  amount = null;

  purchaseOrder = null;
  maxBuyOrderTokens = null;
  buySlippage = null;
  buyPositionFilters = { creatorAddMarketCap: 0, };

  sellSlippage = 2;
  sellPositionFilters = { afterPurchase: null, target: null, time: null, };
  stopLoss = { target: 10, };

  // result = { profitAndLossInSol: 0, };

  constructor(config) {
    this.setConfig(config);
  }

  setConfig(config) {
    if (config?.name) this.name = config.name;
    if (config?.amount) this.amount = config.amount;
    if (config?.purchaseOrder) this.purchaseOrder = config.purchaseOrder;
    if (config?.maxBuyOrderTokens) this.maxBuyOrderTokens = config.maxBuyOrderTokens;
    if (config?.buySlippage) this.buySlippage = config.buySlippage;
    if (config?.buyPositionFilters?.creatorAddMarketCap) this.buyPositionFilters.creatorAddMarketCap = config.buyPositionFilters.creatorAddMarketCap;
    if (config?.sellSlippage) this.sellSlippage = config.sellSlippage;
    if (config?.sellPositionFilters?.afterPurchase) this.sellPositionFilters.afterPurchase = config.sellPositionFilters.afterPurchase;
    if (config?.sellPositionFilters?.target) this.sellPositionFilters.target = config.sellPositionFilters.target;
    if (config?.sellPositionFilters?.time) this.sellPositionFilters.time = config.sellPositionFilters.time;
    if (config?.stopLoss) this.stopLoss.target = config.stopLoss.target;
  }

  async closeAllPositions() {
    for (let i = 0; i < this.positions.length; i++)
      if (this.positions[i].getStatus() == 'open') {
        try {
          await this.positions[i].close();
        } catch {
          if (this.positions[i].getStatus() == 'open') {
            await this.positions[i].forceClose();
          }
        }
      }
  }

  activate() { this.isActive = true; }

  async deActivate() {
    this.isActive = false;
    this.closeAllPositions();
  }

  getPositions() {
    return this.positions;
  }

  checkContractForOpeningPosition(contract) {

    for (const strategy of Object.values(strategies)) {
      if (strategy.getPositions().filter((pos) => (pos.getMint() == contract.getMint() && ['inQueue', 'opening', 'open', 'closing'].includes(pos.getStatus()))).length) return false;
    }

    if (
      this.purchaseOrder &&
      (
        contract.getTransactions().length - 1 >= this.purchaseOrder - 1 ||
        getBuyTransactionCount(contract.getMint()) != this.purchaseOrder - 1
      )
    ) return false;

    if (this.positions.filter((pos) => (['inQueue', 'opening', 'open', 'closing'].includes(pos.getStatus()))).length >= this.maxBuyOrderTokens) return false;
    if (this.buyPositionFilters.creatorAddMarketCap && this.buyPositionFilters.creatorAddMarketCap > contract.getMarketCapSol()) return false;

    let allOpenPositionsSum = 0;
    for (const stg of Object.values(strategies))
      allOpenPositionsSum += stg.getPositions().filter((pos) => (['inQueue', 'opening', 'open', 'closing'].includes(pos.getStatus()))).length;
    if (allOpenPositionsSum >= MaxOpenPositions) return false;

    return true;
  }

  async checkForOpenNewPosition() {

    if (!this.isActive) return;

    for (const contract of Object.values(contracts)) {
      if (this.checkContractForOpeningPosition(contract) == true) {
        // opening new position
        const pos = new Position(this.amount, contract.getMint(), this.buySlippage, this.sellSlippage);
        const index = this.positions.push(pos) - 1;
        this.positions[index].open();
      }
    }
  }

  async checkInQueuePositions() {
    for (let i = 0; i < this.positions.length; i++) {
      if (this.positions[i].getStatus() == 'inQueue') {
        if (contracts[this.positions[i].getMint()] && this.checkContractForOpeningPosition(contracts[this.positions[i].getMint()]) && this.isActive) {
          this.positions[i].open();
        } else {
          this.positions[i].setStatus('failed');
        }
      }
    }
  }

  async checkPositionsForClose() {
    for (let i = 0; i < this.positions.length; i++) {
      if (this.positions[i].getStatus() == 'open') {
        const contract = contracts[this.positions[i].getMint()];
        if (!contract) {
          this.positions[i].forceClose();
          return;
        }

        let closeFlag = false;

        if (this.sellPositionFilters.afterPurchase && contract.getTransactions().filter((trx) => (trx.createdAt >= this.positions[i].createdAt)).length >= this.sellPositionFilters.afterPurchase) closeFlag = true, console.log('🛒 afterPurchase hit');

        if (this.sellPositionFilters.target && this.positions[i].getResult() >= this.sellPositionFilters.target) closeFlag = true, console.log('target hit, percent: 🟢 ', this.positions[i].getResult(), '%');
        if (this.stopLoss.target && this.positions[i].getResult() <= this.stopLoss.target * -1) closeFlag = true, console.log('stoploss hit, percent: 🔴 ', this.positions[i].getResult(), '%', ` openPrice: ${this.positions[i].solAmount}, closePrice: ${contract.getPrice()}, Result: ${this.positions[i].getResult()}`);

        if (this.sellPositionFilters.time && this.sellPositionFilters.time < getNowDateSecond() - this.positions[i].createdAt) closeFlag = true, console.log('🕐 time limit hit');

        if (closeFlag) {
          this.positions[i].close();
        }
      }
    }
  }
}

async function bot(pump) {

  pump.setupWebSocket();

  setInterval(async () => {

    for (const id of Object.keys(strategies)) {
      if (strategies[id]) {
        strategies[id].checkInQueuePositions();
        strategies[id].checkForOpenNewPosition();
        strategies[id].checkPositionsForClose();
      }
    }

    writeFileSync(JsonFiles.contracts, JSON.stringify(contracts));
    writeFileSync(JsonFiles.strategies, JSON.stringify(strategies));

  }, 2000);

  // kind of system monitoring
  setInterval(() => {
    let buys = 0, sells = 0;
    Object.values(contracts).forEach((contract) => {
      buys += contract.getTransactions().filter((trx) => (trx.getType() == 'buy')).length;
      sells += contract.getTransactions().filter((trx) => (trx.getType() == 'sell')).length;
    });
    let positions = {
      'open': 0,
      'inQueue': 0,
      'close': 0,
      'force-close': 0,
      'failed': 0,
    };
    Object.values(strategies).forEach((stg) => {
      stg.getPositions().forEach((pos) => (positions[pos.getStatus()]++));
    });
    console.log(`MEMORY: [ CONTRACTS: ${Object.values(contracts).length} ] -- [ BUY_TRX: ${buys} ] -- [ SELL_TRX: ${sells} ] -- [ OPEN_POS: ${positions.open} ] -- [ CLOSE_POS ${positions.close} ] -- [ FORCE_CLOSE_POS ${positions['force-close']} ] -- [ FAIL_POS ${positions.failed} ]`);
  }, 1000);
}

async function main() {

  await checkWalletBalance();
  const pump = new PumpApi();
  bot(pump);

  const app = express()
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const port = 1236;

  app.post('/', (req, res) => {
    const stgs = [];
    for (const strategyId of Object.keys(strategies)) {
      const stg = { id: strategyId, config: JSON.parse(JSON.stringify(strategies[strategyId])), isActive: strategies[strategyId].isActive, positions: [], resultSol: 0, };
      for (const position of strategies[strategyId].getPositions()) {
        stg.positions.push({ ...JSON.parse(JSON.stringify(position)), resultSol: position.getResult() * position.openPrice, resultPercent: position.getResult(), }), stg.resultSol += (position.getResult() * position.openPrice);
      }
      stgs.push(stg);
    }
    res.send(JSON.stringify({ ok: true, data: { strategies: stgs, bot: { status: pump.getStatus() } } }));
  });

  app.post('/turn-off-bot', (req, res) => {
    pump.handleWsSleep();
    for (let stgId of Object.keys(strategies))
      strategies[stgId].deActivate();
    res.json({ ok: true });
  });

  app.post('/turn-on-bot', (req, res) => {
    pump.handleWsWakeup();
    res.json({ ok: true });
  });

  app.post('/activate-strategy/:stgId', (req, res) => {
    const stgId = req.params['stgId'];
    if (pump.getStatus() == 'on' && !strategies[stgId]?.isActive)
      strategies[stgId]?.activate(), res.json({ ok: true });
    else res.json({ ok: false, msg: 'the bot is off or the stg is already deactive!' });
  });

  app.post('/deactivate-strategy/:stgId', (req, res) => {
    const stgId = req.params['stgId'];
    if (strategies[stgId]?.isActive)
      strategies[stgId]?.deActivate();
    res.json({ ok: true });
  });

  app.post('/new-strategy', (req, res) => {
    const data = req.body;
    try {
      const stg = new Strategy(data.config);
      strategies[data.id] = stg;
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, msg: e.message, data: e });
    }
  });

  app.post('/edit-strategy/:stgId', (req, res) => {
    const stgId = req.params['stgId'];
    try {
      strategies[stgId]?.setConfig(data.config);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, msg: e.message, data: e });
    }
  });

  app.post('/delete-strategy/:stgId', async (req, res) => {
    const stgId = req.params['stgId'];
    try {
      await strategies[stgId]?.deActivate();
      delete strategies[stgId];
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, msg: e.message, data: e });
    }
  });

  app.listen(port, () => {
    console.log(`bot listening on port ${port}`);
  });

}

main();