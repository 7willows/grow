import { _, existsSync, path } from "./deps.ts";
import { Field, PlantDef, Service } from "./types.ts";

type InstantiateRequest = {
  proc: string;
  dir: string;
  plants: {
    name: string;
    def: PlantDef;
  }[];
};

type IMessageBus = EventTarget & {
  postMessage(message: any): void;
};

type Instance = {
  plantName: string;
  plantDef: PlantDef;
  messageBus: IMessageBus;
};

type Proc = {
  proc: string;
  dir: string;
  instances: Instance[];
  kill: () => void;
};

const ports = new Map<string, MessagePort>();

const logger = getLogger({
  name: `WORKER[${plantName}]`,
  sessionId: "",
  requestId: "",
});

function instantiateProcs(dir: string, field: Field): Proc[] {
  const procs: Proc[] = [];
  const plants = Object.entries(field.plants);

  const byProcs: Record<string, { plantName: string; plantDef: PlantDef }>[] = _
    .chain(plants)
    .map(plants, ([plantName, plantDef]: any) => ({
      plantName,
      plantDef,
    }))
    .groupBy((p) => p.plantDef.proc ?? p.plantName)
    .value();

  for (const [proc, plants] of Object.entries(byProcs)) {
    const req: InstantiateRequest = {
      proc,
      dir,
      plants: plants.map((p) => ({
        name: p.plantName,
        def: p.plantDef,
      })),
    };

    if (proc === "main") {
      procs.push(instantiateClasses(req));
    } else {
      // instances = {
      //   ...instances,
      //   ...instantiateWorkers(req),
      // };
    }
  }

  return procs;
}

function instantiateClasses(req: InstantiateRequest): Proc {
  const kill = () => {
  };
  const instances: Instance[] = [];
  const objects: { [plantName: string]: { instance: Instance; obj: any } } = {};

  for (const plant of req.plants) {
    const instance = {
      messageBus: new LocalMessageBus(),
      plantName: plant.name,
      plantDef: plant.def,
    };

    objects[plant.name] = {
      instance,
      obj: {},
    };

    const servicePath = determineServicePath(req.dir, plant.name, plant.def);
    import(servicePath).then((mod) => {
      const obj = new mod[plant.name]();
      objects[plant.name].obj = obj;
      initPlantInstance(obj, instance);
    });

    instances.push(instance);
  }

  return {
    proc: req.proc,
    dir: req.dir,
    instances: [],
    kill,
  };
}

function initPlantInstance(obj: any, instance: Instance) {
  instance.messageBus.addEventListener("message", async (event) => {
    if (event.data.init) {
      await updateConfig(obj, event.data.init.config);
      assignLoggers(obj);
      toInject.forEach((injectedPlantName: string, index: number) => {
        const port = event.ports[index];
        listenOnPort(port);
        ports.set(injectedPlantName, port);
      });
      await callInit();
      instance.messageBus.postMessage({ initialized: true });
      return;
    }

    if (event.data.configUpdate) {
      updateConfig(obj, event.data.configUpdate.config);
      return;
    }

    if (event.data.call) {
      callPlant(obj, event.data.call);
      return;
    }

    if (event.data.callResult) {
      manageResult(obj, event.data.callResult);
    }

    if (event.data.inject) {
      const port = event.ports[0];
      listenOnPort(port);
      ports.set(event.data.inject.plantName, port);
      return;
    }
  });
}

function instantiateWorker(
  plantDef: PlantDef,
  plantName: string,
  dir: string,
) {
  const servicePath = determineServicePath(dir, plantName, plantDef);
  const queryString = `plantName=${plantName}&servicePath=${servicePath}`;

  const worker = new Worker(
    new URL(`./worker.ts?${queryString}`, import.meta.url),
    { type: "module" },
  );

  return {
    worker,
    plantDef,
    plantName,
    contracts: plantDef.contracts,
  };
}

function determineServicePath(
  dir: string,
  plantName: string,
  plantDef: PlantDef,
) {
  if (plantDef.filePath) {
    return path.join(dir, plantDef.filePath);
  }

  const fileName = toUnderscoreCase(plantName);
  let p = path.join(dir, fileName + ".ts");

  if (existsSync(p)) {
    return p;
  }

  p = path.join(dir, fileName, "mod.ts");

  if (existsSync(p)) {
    return p;
  }

  throw new Error("Could not find service " + plantName);
}

function toUnderscoreCase(text: string) {
  text = text[0].toLowerCase() + text.slice(1);
  return text.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

class LocalMessageBus extends EventTarget implements IMessageBus {
  postMessage(message: any) {
    self.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}
