const stores = new Map<
  string, // decorator name
  Map<
    string | symbol, // field name
    Map<string, any> // target object class name, metadata
  >
>();

function getStore(
  decoratorName: string,
  fieldName: string | symbol,
): Map<any, any> {
  if (!stores.has(decoratorName)) {
    stores.set(decoratorName, new Map());
  }

  const s = stores.get(decoratorName)!;

  if (!s.has(fieldName)) {
    s.set(fieldName, new Map());
  }

  return s.get(fieldName)!;
}

export class Reflect {
  public static metadata(decoratorName: string, metadata: any) {
    return function decorator(
      value: any,
      ctx: any,
    ) {
      const store = getStore(decoratorName, ctx.name);

      if (typeof value === "function") {
        ctx.addInitializer(function (this: any) {
          store.set(this.constructor.name, metadata);
        });

        return value;
      }

      return function (this: any): any {
        store.set(this.constructor.name, metadata);
        return null;
      };
    };
  }

  public static getMetadata(
    decoratorName: string,
    target: any,
    field: string,
  ): any {
    return getStore(decoratorName, field).get(target.constructor.name);
  }
}
