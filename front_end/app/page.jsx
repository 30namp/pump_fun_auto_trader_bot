'use client';

import '@ant-design/v5-patch-for-react-19';

import { Button } from 'antd';
import { DownOutlined, PercentageOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { message, Badge, Dropdown, Space, Table, Input, Switch, Divider, InputNumber, Drawer, Form } from 'antd';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner'

function getRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function generateStrategyId() {
  return getRandomString(50);
}

const items = [
  { key: '1', label: 'Action 1' },
  { key: '2', label: 'Action 2' },
];

const expandDataSource = Array.from({ length: 3 }).map((_, i) => ({
  key: i.toString(),
  date: '2014-12-24 23:12:00',
  name: 'This is production name',
  upgradeNum: 'Upgraded: 56',
}));

const dataSource = Array.from({ length: 3 }).map((_, i) => ({
  key: i.toString(),
  name: 'Screen',
  platform: 'iOS',
  version: '10.3.4.5654',
  upgradeNum: 500,
  creator: 'Jack',
  createdAt: '2014-12-24 23:12:00',
}));

const expandColumns = [
  { title: 'Date', dataIndex: 'date', key: 'date' },
  { title: 'Name', dataIndex: 'name', key: 'name' },
  {
    title: 'Status',
    key: 'state',
    render: () => <Badge status="success" text="Finished" />,
  },
  { title: 'Upgrade Status', dataIndex: 'upgradeNum', key: 'upgradeNum' },
  {
    title: 'Action',
    key: 'operation',
    render: () => (
      <Space size="middle">
        <a>Pause</a>
        <a>Stop</a>
        <Dropdown menu={{ items }}>
          <a>
            More <DownOutlined />
          </a>
        </Dropdown>
      </Space>
    ),
  },
];

const expandedRowRender = (row) => {

  return (
    <Table
      columns={expandColumns}
      dataSource={expandDataSource}
      pagination={false}
    />
  )
};

export default function Home() {

  const [form] = Form.useForm();

  const [messageApi, contextHolder] = message.useMessage();

  const [showStrategyForm, setShowStrategyForm] = useState(false);
  const [editStrategyId, setEditStrategyId] = useState(null);

  const [strategies, setStrategies] = useState([]);

  let ws = new WebSocket('ws://localhost:1236');

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount' },
    { title: 'PurchaseOrder', dataIndex: 'purchaseOrder', key: 'purchaseOrder' },
    { title: 'CreatorAddMarketCap', dataIndex: 'creatorAddMarketCap', key: 'creatorAddMarketCap' },
    { title: 'Positions', dataIndex: 'positions', key: 'positions' },
    { title: 'Result', dataIndex: 'resultSol', key: 'resultSol' },
    {
      title: 'Action', key: 'operation', render: (_, record) => (
        <Space size="middle">
          <Button icon={<DeleteOutlined />} onClick={() => {
            if (ws.readyState) {
              ws.send(JSON.stringify({
                query: 'delete-strategy',
                id: record.id,
              }));
              messageApi.success('strategy updated!');
            } else {
              messageApi.error('bot is not connected!');
            }
          }} />
          <Switch defaultChecked={record.isActive} onClick={() => {
            if (ws.readyState) {
              const query = record.isActive ? 'deactivate-strategy' : 'activate-strategy';
              ws.send(JSON.stringify({ query: query, id: record.id, }));
              ws.send(JSON.stringify({ query: query, id: record.id, }));
              ws.send(JSON.stringify({ query: query, id: record.id, }));
              messageApi.success('strategy updated!');
            } else {
              messageApi.error('bot is not connected!');
            }
          }} />
        </Space>
      )
    },
  ];

  useEffect(() => {

    ws.onopen = () => {
      console.log('connected to bot!');
      toast.success('connected to bot!');
    };

    ws.onmessage = (msg) => {
      const json = msg.data;
      const obj = JSON.parse(json);
      setStrategies(obj.data.strategies);
      console.log(obj.data.strategies);
    };

    ws.onclose = () => {
      toast.error('bot connection loss!');
    };
  }, []);

  const onStrategyFormClose = async () => {
    setShowStrategyForm(false);
    setEditStrategyId(null);
  };

  async function handleStrategySubmit(data) {

    const strategy = {
      name: data['strategy-name'],
      amount: data['amount'],
      purchaseOrder: data['purchase-order'],
      maxBuyOrderTokens: data['max-buy-order-tokens'],
      buySlippage: data['max-buy-slippage-limit'],
      buyPositionFilters: {
        creatorAddMarketCap: data['buy-position-filter-creator-add-market-cap'],
      },
      sellSlippage: data['max-sell-slippage-limit'],
      sellPositionFilters: {
        afterPurchase: data['sell-position-filter-after-purchase'],
        target: data['sell-position-filter-target'],
        time: data['sell-position-filter-time-seconds'],
      },
      stopLoss: {
        target: data['stop-loss'],
      },
    };

    if (ws.readyState) {
      console.log(editStrategyId);
      ws.send(JSON.stringify({
        query: editStrategyId ? 'edit-strategy' : 'new-strategy',
        id: editStrategyId ?? generateStrategyId(),
        config: strategy
      }));
      messageApi.open({
        type: 'success',
        content: 'strategy saved!',
      });
    } else {
      messageApi.open({
        type: 'error',
        content: 'bot is not connected!',
      });
    }

    onStrategyFormClose();
  }

  console.log(strategies);

  return (
    <>
      {contextHolder}
      <Button type='primary' className='self-start' onClick={() => (setShowStrategyForm(true))}>New Strategy</Button>
      <Table
        className='min-w-[930px]'
        columns={columns}
        // expandable={{ expandedRowRender, defaultExpandedRowKeys: [] }}
        dataSource={strategies.map((stg) => ({
          key: stg.id,
          id: stg.id,
          name: stg.config.name,
          amount: stg.config.amount,
          purchaseOrder: stg.config.purchaseOrder ? 'yes' : 'no',
          resultSol: Number.parseFloat(stg.resultSol),
          maxBuyOrderTokens: stg.config.maxBuyOrderTokens,
          creatorAddMarketCap: stg.config.buyPositionFilters.creatorAddMarketCap,
          isActive: stg.isActive,
          positions: `all: ${stg.positions.length} - open: ${stg.positions.filter((pos) => (['opening', 'open', 'closing'].includes(pos.status))).length}`,
        }))}
      />
      <Drawer
        title="Strategy Form"
        placement='right'
        width={500}
        onClose={onStrategyFormClose}
        open={showStrategyForm}
      >
        <Form form={form} onFinish={handleStrategySubmit} layout='vertical' className="grid grid-cols-2 gap-4 px-8 py-6 my-6 ">
          <Form.Item label="Strategy name:" name="strategy-name">
            <Input
              placeholder="type name..."
              required
            />
          </Form.Item>
          <Form.Item name="purchase-order" label="Purchase Order:" valuePropName='checked'>
            <Switch id="2" />
          </Form.Item>
          <Form.Item label="Amount:" name="amount">
            <InputNumber
              addonAfter="SOL"
              min="0"
              step="0.000001"
              placeholder="type..."
            />
          </Form.Item>
          <Form.Item label="Max buy Order Tokens:" name="max-buy-order-tokens">
            <InputNumber
              addonAfter="count"
              min="0"
              step="1"
              placeholder="type..."
            />
          </Form.Item>
          <Divider className='col-span-2'>Buy Position Filters</Divider>
          <Form.Item label="creator add Market cap+:" name="buy-position-filter-creator-add-market-cap">
            <InputNumber
              addonAfter="SOL"
              placeholder="type..."
            />
          </Form.Item>
          <Form.Item label="buy slippage limit:" name="max-buy-slippage-limit">
            <InputNumber
              addonAfter={<PercentageOutlined />}
              placeholder="enter..."
              min="0"
              max="100"
              required
            />
          </Form.Item>
          <Divider className='col-span-2'>Sell Position Filters</Divider>
          <Form.Item label="after_purchase:" name="sell-position-filter-after-purchase">
            <InputNumber
              addonAfter="count"
              placeholder="type..."
            />
          </Form.Item>
          <Form.Item label="target:" name="sell-position-filter-target">
            <InputNumber

              addonAfter={<PercentageOutlined />}
              placeholder="type..."
              min="0"
              max="100"
            />
          </Form.Item>
          <Form.Item label="time:" name="sell-position-filter-time-seconds">
            <InputNumber

              addonAfter="seconds"
              placeholder="type..."
            />
          </Form.Item>
          <Form.Item label="sell slippage limit:" name="max-sell-slippage-limit" >
            <InputNumber
              addonAfter={<PercentageOutlined />}
              placeholder="type..."
              min="0"
              max="100"
              required
            />
          </Form.Item>
          <Divider className='col-span-2'></Divider>
          <Form.Item label="Stop Loss:" name="stop-loss">
            <InputNumber
              addonAfter={<PercentageOutlined />}
              placeholder="type..."
              min="0"
              max="100"
              required
            />
          </Form.Item>
          <Form.Item className="col-span-2">
            <Button type="primary" className='w-full' htmlType='submit'>Save</Button>
          </Form.Item>
        </Form>
      </Drawer>
      <Toaster position='top-center' />
    </>
  );
}
