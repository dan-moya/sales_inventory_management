import Dexie, { type Table } from 'dexie';
import { v4 as uuidv4 } from 'uuid';
import { Database } from './database.types';

type Product = Database['public']['Tables']['products']['Row'] & {
	pending_image?: string | null;
	pending_stock_changes?: number;
};
type Sale = Database['public']['Tables']['sales']['Row'];
type SaleItem = Database['public']['Tables']['sale_items']['Row'];
type Category = Database['public']['Tables']['categories']['Row'];

export interface PendingOperation {
	id: string;
	type: 'create' | 'update' | 'delete' | 'stock_update';
	table: string;
	data: any;
	timestamp: number;
	status: 'pending' | 'processing' | 'error';
	error?: string;
	retryCount: number;
	priority: number;
	parentId?: string; // Para relacionar operaciones dependientes
}

export class OfflineDB extends Dexie {
	products!: Table<Product>;
	sales!: Table<Sale>;
	saleItems!: Table<SaleItem & { product?: Product }>;
	categories!: Table<Category>;
	pendingOperations!: Table<PendingOperation>;

	constructor() {
		super('OfflineDB');
		this.version(5).stores({
			products: 'id, code, name, category_id, is_hidden, pending_stock_changes',
			sales: 'id, date',
			saleItems: 'id, sale_id, product_id',
			categories: 'id, name',
			pendingOperations: 'id, type, table, status, timestamp, priority, parentId',
		});
	}

	async addPendingOperation(
		type: PendingOperation['type'], 
		table: string, 
		data: any, 
		priority: number = 0,
		parentId?: string
	) {
		const operation: PendingOperation = {
			id: uuidv4(),
			type,
			table,
			data,
			timestamp: Date.now(),
			status: 'pending',
			retryCount: 0,
			priority,
			parentId
		};
		await this.pendingOperations.add(operation);
		console.log(`[DB] Nueva operación pendiente:`, {
			id: operation.id,
			type,
			table,
			priority,
			parentId
		});
	}

	async getFailedOperations() {
		return this.pendingOperations.where('status').equals('error').toArray();
	}

	async getPendingOperations() {
		const operations = await this.pendingOperations
			.where('status')
			.equals('pending')
			.toArray();

		// Ordenar por:
		// 1. Prioridad (mayor a menor)
		// 2. Dependencias (padres antes que hijos)
		// 3. Timestamp (más antiguos primero)
		return operations.sort((a, b) => {
			// Si uno es padre del otro, el padre va primero
			if (b.id === a.parentId) return 1;
			if (a.id === b.parentId) return -1;

			// Si tienen diferente prioridad, la mayor va primero
			if (b.priority !== a.priority) {
				return b.priority - a.priority;
			}

			// Si tienen la misma prioridad, el más antiguo va primero
			return a.timestamp - b.timestamp;
		});
	}

	async updateOperationStatus(id: string, status: PendingOperation['status'], error?: string) {
		await this.pendingOperations.update(id, {
			status,
			error,
			retryCount: status === 'error' ? (await this.pendingOperations.get(id))!.retryCount + 1 : 0,
		});
		console.log(`[DB] Estado de operación actualizado:`, { id, status, error });
	}

	async clearAllData() {
		await this.transaction(
			'rw',
			this.products,
			this.sales,
			this.saleItems,
			this.categories,
			this.pendingOperations,
			async () => {
				await this.products.clear();
				await this.sales.clear();
				await this.saleItems.clear();
				await this.categories.clear();
				await this.pendingOperations.clear();
			}
		);
	}
}

export const db = new OfflineDB();