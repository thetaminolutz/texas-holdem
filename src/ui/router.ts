import { Store } from '../state/store';

export type RouteName =
  | 'menu' | 'play' | 'setup' | 'game' | 'settings' | 'stats' | 'history' | 'replay'
  | 'training' | 'achievements' | 'howto' | 'about' | 'lab';

export interface Route {
  name: RouteName;
  params?: Record<string, any>;
}

export const routeStore = new Store<Route>({ name: 'menu' });
const stack: Route[] = [];

export function go(name: RouteName, params?: Record<string, any>) {
  stack.push(routeStore.get());
  routeStore.set({ name, params });
}
export function back() {
  routeStore.set(stack.pop() ?? { name: 'menu' });
}
export function home() {
  stack.length = 0;
  routeStore.set({ name: 'menu' });
}
