const stores = new Map<
  string, // decorator name
  Map<
    string | symbol, // field name
    Map<any, any> // target object, metadata
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
    return function fieldDecorator<C, V>(
      _target: any,
      ctx: ClassFieldDecoratorContext<C, V>,
    ) {
      const store = getStore(decoratorName, ctx.name);
      return function (this: any, _: V): any {
        store.set(this, metadata);
        return null;
      };
    };
  }

  public static getMetadata(
    decoratorName: string,
    target: any,
    field: string,
  ): any {
    return getStore(decoratorName, field).get(target);
  }
}
