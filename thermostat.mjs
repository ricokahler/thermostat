// @ts-check
import express from 'express';
import DHT22 from '@ricokahler/node-dht22';
import ChildProcess from 'node:child_process';
import { promisify } from 'util';

const exec = promisify(ChildProcess.exec);

const GPIO_HEADER = '7J1';
const PIN_HEATING = 16; // PIN 16
const PIN_COOLING = 12; // PIN 12
const PIN_FAN = 10; // PIN 10

const PORT = 4201;

class Thermostat {
  action = 'off';
  state = { mode: 'off', target: undefined, temperature: undefined };

  constructor(options) {
    this.options = options;
  }

  update(state) {
    this.state = { ...this.state, ...state };
    const action = Thermostat.calculateAction(this.state);

    if (this.action !== action) {
      this.action = action;
      this.options.onActionChange(action);
    }
  }

  static calculateAction(state) {
    if (state.mode === 'off') return 'off';
    if (state.mode === 'fan-only') return 'fan';
    if (!state.target) return 'idle';
    if (!state.temperature) return 'idle';

    const lower = Array.isArray(state.target) ? state.target[0] : state.target;
    const upper = Array.isArray(state.target) ? state.target[1] : state.target;
    const allowsHeat = state.mode === 'heat' || state.mode === 'heat-cool';
    const allowsCool = state.mode === 'cool' || state.mode === 'heat-cool';

    if (allowsHeat && state.temperature < upper) return 'heating';
    if (allowsCool && state.temperature > lower) return 'cooling';

    return 'idle';
  }
}

async function handleActionChange(action) {
  switch (action) {
    case 'cooling': {
      await Promise.all([
        exec(`lgpio set ${GPIO_HEADER}_${PIN_COOLING}=1`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_HEATING}=0`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_FAN}=0`),
      ]);
      return;
    }
    case 'heating': {
      await Promise.all([
        exec(`lgpio set ${GPIO_HEADER}_${PIN_COOLING}=0`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_HEATING}=1`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_FAN}=0`),
      ]);
      return;
    }
    case 'fan': {
      await Promise.all([
        exec(`lgpio set ${GPIO_HEADER}_${PIN_COOLING}=0`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_HEATING}=0`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_FAN}=1`),
      ]);
      return;
    }
    default: {
      await Promise.all([
        exec(`lgpio set ${GPIO_HEADER}_${PIN_COOLING}=0`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_HEATING}=0`),
        exec(`lgpio set ${GPIO_HEADER}_${PIN_FAN}=0`),
      ]);
      return;
    }
  }
}

const thermostat = new Thermostat({
  onActionChange: handleActionChange,
});

const app = express();
const api = express.Router();

api.use(express.json());

api.get('/', (_req, res) => {
  res.json({ ...thermostat.state, action: thermostat.action });
});

api.put('/', (req, res) => {
  const { mode, target } = req.body;

  thermostat.update({
    ...(mode && { mode }),
    ...(target && { target }),
  });

  res.json({
    ...thermostat.state,
    action: thermostat.action,
  });
});

app.use('/thermostat', api);

await new Promise((resolve, reject) => {
  const server = app.listen(PORT, resolve);
  server.addListener('error', reject);
});
console.log(`Server up on ${PORT}`);

const temperatureSensor = new DHT22(1, 91);

while (true) {
  const { temperature } = await temperatureSensor.read();
  thermostat.update({ temperature });

  await new Promise((resolve) => setTimeout(resolve, 30 * 1000));
}
