import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Database } from '../lib/database.types';
import { useProductsStore } from './products';
// import { showNotification } from '../utils/notifications';
import { db } from '../lib/db';
import { v4 as uuidv4 } from 'uuid';

type Product = Database['public']['Tables']['products']['Row'];
type Sale = Database['public']['Tables']['sales']['Row'];
type SaleItem = Database['public']['Tables']['sale_items']['Row'];

type SaleWithItems = Sale & {
	items: Array<SaleItem & { product: Product }>;
};

// Interfaz principal del estado de ventas
interface SalesState {
	isOnline: boolean; // Estado de conexión a internet
	isLoading: boolean; // Indicador de carga
	setIsOnline: (status: boolean) => void; // Actualiza el estado de conexión
	sales: SaleWithItems[]; // Lista completa de ventas
	todaySales: number;
	yesterdaySales: number;
	monthSales: number;
	totalSales: number;
	todaySalesList: SaleWithItems[];
	yesterdaySalesList: SaleWithItems[];
	monthSalesList: SaleWithItems[];
	allSales: SaleWithItems[];
	loadSales: () => Promise<void>;
	createSale: (
		items: Array<{ productId: string; quantity: number; price: number }>,
		paymentMethod: 'QR' | 'EFECTIVO'
	) => Promise<void>;
	deleteSale: (saleId: string) => Promise<void>;
	updateSale: (updatedSale: SaleWithItems) => Promise<void>;
	syncPendingSales: () => Promise<void>; // Sincroniza ventas pendientes
}

export const useSalesStore = create<SalesState>((set, get) => ({
	isLoading: false,
	sales: [],
	todaySales: 0,
	yesterdaySales: 0,
	monthSales: 0,
	totalSales: 0,
	todaySalesList: [],
	yesterdaySalesList: [],
	monthSalesList: [],
	allSales: [],
	isOnline: navigator.onLine,

	setIsOnline: (online) =>
		set({
			isOnline: online,
		}),

	// Función principal para cargar ventas
	loadSales: async () => {
		set({ isLoading: true });
		try {
			let salesData: SaleWithItems[] = [];

			if (get().isOnline) {
				// Obtener datos de Supabase (online)
				const { data: sales, error: salesError } = await supabase
					.from('sales')
					.select('*')
					.order('date', { ascending: false });

				if (salesError) throw salesError;

				if (sales) {
					// Procesar items de cada venta
					const salesWithItems = await Promise.all(
						sales.map(async (sale) => {
							const { data: saleItems, error: itemsError } = await supabase
								.from('sale_items')
								.select('*, product:products(*)')
								.eq('sale_id', sale.id);

							if (itemsError) throw itemsError;

							return {
								...sale,
								items: saleItems || [],
							};
						})
					);

					// Guardar en IndexedDB para modo offline
					await db.sales.clear();
					await db.saleItems.clear();

					for (const sale of salesWithItems) {
						await db.sales.put({
							id: sale.id,
							date: sale.date,
							payment_method: sale.payment_method,
							total: sale.total,
							created_at: sale.created_at,
						});

						for (const item of sale.items) {
							await db.saleItems.put({
								...item,
								product: item.product,
							});
						}
					}

					salesData = salesWithItems;
				}
			}

			// Obtener ventas almacenadas localmente
			const offlineSales = await db.sales.toArray();
			const salesWithItems = await Promise.all(
				offlineSales.map(async (sale) => {
					const items = await db.saleItems.where('sale_id').equals(sale.id).toArray();

					const itemsWithProducts = await Promise.all(
						items.map(async (item) => {
							const product = await db.products.get(item.product_id);
							if (!product) {
								console.warn(`Product not found locally for item with ID ${item.product_id}`);
								return null;
							}
							return { ...item, product };
						})
					);

					return {
						...sale,
						items: itemsWithProducts.filter(
							(item): item is SaleItem & { product: Product } => item !== null
						),
					};
				})
			);

			// Combinar datos online/offline y procesar
			const allSales = get().isOnline
				? [
						...salesData,
						...salesWithItems.filter((sale) => {
							const exists = salesData.some((onlineSale) => onlineSale.id === sale.id);
							return !exists && sale.items.length > 0;
						}),
				  ]
				: salesWithItems;

			await processSalesData(allSales, set);
		} catch (error) {
			console.error('Error al cargar las ventas:', error);
		} finally {
			set({ isLoading: false });
		}
	},

	// Crear nueva venta (funciona en online/offline)
	createSale: async (items, paymentMethod) => {
		const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		const saleId = uuidv4();
		const now = new Date().toISOString();

		// Crear objeto de venta
		const newSale = {
			id: saleId,
			date: now,
			payment_method: paymentMethod,
			total,
			created_at: now,
		};

		// Crear items de venta
		const saleItems = items.map((item) => ({
			id: uuidv4(),
			sale_id: saleId,
			product_id: item.productId,
			quantity: item.quantity,
			price: item.price,
			created_at: now,
		}));

		try {
			// Guardar en IndexedDB (localmente) primero
			await db.sales.add(newSale);
			console.log('[OFFLINE] Venta guardada:', saleId);

			for (const item of saleItems) {
				// Actualizar stock local
				const product = await db.products.get(item.product_id);
				if (product) {
					await db.saleItems.add({
						...item,
						product,
					});

					const newStock = Math.max(0, product.stock - item.quantity);
					const newPendingChanges = (product.pending_stock_changes || 0) + item.quantity;

					await db.products.update(item.product_id, {
						stock: newStock,
						pending_stock_changes: newPendingChanges,
					});
				}
			}

			// Si hay conexión: sincronizar con servidor
			if (get().isOnline) {
				// Si hay conexión, crear la venta en Supabase primero
				const { error: saleError } = await supabase.from('sales').insert(newSale);

				if (saleError) {
					throw saleError;
				}

				// Una vez creada la venta, crear los items
				const { error: itemsError } = await supabase.from('sale_items').insert(saleItems);

				if (itemsError) {
					// Si hay error al crear los items, eliminar la venta
					await supabase.from('sales').delete().eq('id', saleId);
					throw itemsError;
				}

				// Actualizar el stock en Supabase
				for (const item of saleItems) {
					const { data: product } = await supabase
						.from('products')
						.select('stock')
						.eq('id', item.product_id)
						.single();

					if (product) {
						const newStock = Math.max(0, product.stock - item.quantity);
						await supabase.from('products').update({ stock: newStock }).eq('id', item.product_id);
					}
				}
			} else {
				// Si no hay conexión, agregar a operaciones pendientes
				await db.addPendingOperation('create', 'sales', newSale, 1);
				for (const item of saleItems) {
					await db.addPendingOperation('create', 'sale_items', item, 0);
				}
				console.log('[OFFLINE] Operaciones pendientes guardadas');
			}

			// Actualizar estados
			await get().loadSales();
			await useProductsStore.getState().loadProducts();
		} catch (error) {
			console.error('[ERROR] Error creating sale:', error);
			throw error;
		}
	},

	// Eliminar venta y revertir stock
	deleteSale: async (saleId: string) => {
		try {
			// Obtener los items de la venta antes de eliminarla
			const saleItems = await db.saleItems.where('sale_id').equals(saleId).toArray();

			if (get().isOnline) {
				// Primero actualizar el stock de los productos
				for (const item of saleItems) {
					const { data: product } = await supabase
						.from('products')
						.select('stock')
						.eq('id', item.product_id)
						.single();

					if (product) {
						// Devolver la cantidad vendida al stock
						const newStock = product.stock + item.quantity;
						const { error: updateError } = await supabase
							.from('products')
							.update({ stock: newStock })
							.eq('id', item.product_id);

						if (updateError) throw updateError;
					}
				}

				// Luego eliminar los items de la venta
				const { error: itemsError } = await supabase.from('sale_items').delete().eq('sale_id', saleId);

				if (itemsError) throw itemsError;

				// Finalmente eliminar la venta
				const { error: saleError } = await supabase.from('sales').delete().eq('id', saleId);

				if (saleError) throw saleError;
			} else {
				// En modo offline, actualizar el stock local
				for (const item of saleItems) {
					const product = await db.products.get(item.product_id);
					if (product) {
						const newStock = product.stock + item.quantity;
						const newPendingChanges = (product.pending_stock_changes || 0) - item.quantity;

						await db.products.update(item.product_id, {
							stock: newStock,
							pending_stock_changes: newPendingChanges,
						});
					}
				}

				// Guardar operaciones pendientes para sincronización
				for (const item of saleItems) {
					await db.addPendingOperation('delete', 'sale_items', { id: item.id }, 1);
				}
				await db.addPendingOperation('delete', 'sales', { id: saleId }, 0);
			}

			// Actualizar estado local
			await db.saleItems.where('sale_id').equals(saleId).delete();
			await db.sales.delete(saleId);

			// Actualizar estado
			set((state) => ({
				sales: state.sales.filter((sale) => sale.id !== saleId),
			}));

			// Recargar ventas y productos para actualizar totales y stock
			await get().loadSales();
			await useProductsStore.getState().loadProducts();
		} catch (error) {
			console.error('Error deleting sale:', error);
			throw error;
		}
	},

	updateSale: async (updatedSale: SaleWithItems) => {
		try {
			console.log('[UPDATE_SALE] Iniciando actualización de venta:', {
				id: updatedSale.id,
				items: updatedSale.items.length,
				isOnline: get().isOnline,
			});

			const originalSale = get().sales.find((s) => s.id === updatedSale.id);
			if (!originalSale) {
				throw new Error('Venta no encontrada');
			}

			// 1. Calcular diferencia de cantidades para cada producto
			const quantityChanges = new Map<string, number>();

			console.log('[UPDATE_SALE] Items originales:', originalSale.items);
			console.log('[UPDATE_SALE] Items actualizados:', updatedSale.items);

			// Agrupar items originales por producto
			originalSale.items.forEach((item) => {
				const current = quantityChanges.get(item.product.id) || 0;
				quantityChanges.set(item.product.id, current + item.quantity);
			});
	

			// Agrupar items nuevos por producto
			updatedSale.items.forEach((item) => {
				const current = quantityChanges.get(item.product.id) || 0;
				quantityChanges.set(item.product.id, current - item.quantity);
			});

			// 2. Calcular el delta real para cada producto
			const stockDeltas = new Map<string, number>();
			quantityChanges.forEach((delta, productId) => {
				stockDeltas.set(productId, delta);
			});

			if (get().isOnline) {
				console.log('[UPDATE_SALE] Actualizando en modo online');

				// Actualizar la venta
				const { error: saleError } = await supabase
					.from('sales')
					.update({
						payment_method: updatedSale.payment_method,
						total: updatedSale.total,
					})
					.eq('id', updatedSale.id);

				if (saleError) throw saleError;

				// Actualizar cada item
				for (const item of updatedSale.items) {
					const { error: updateError } = await supabase
						.from('sale_items')
						.update({
							quantity: item.quantity,
							price: item.price,
						})
						.eq('id', item.id)
						.eq('sale_id', updatedSale.id);

					if (updateError) throw updateError;
				}

				// Actualizar stock de productos
				for (const [productId, stockChange] of stockDeltas) {
					const { data: product } = await supabase
						.from('products')
						.select('stock')
						.eq('id', productId)
						.single();

					if (product) {
						const newStock = Math.max(0, product.stock + stockChange);
						const { error: stockError } = await supabase
							.from('products')
							.update({ stock: newStock })
							.eq('id', productId);

						if (stockError) throw stockError;
					}
				}
			} else {
				console.log('[UPDATE_SALE] Actualizando en modo offline');

				// Guardar cambios localmente
				const saleData = {
					id: updatedSale.id,
					date: updatedSale.date,
					payment_method: updatedSale.payment_method,
					total: updatedSale.total,
					created_at: updatedSale.created_at,
				};

				await db.sales.put(saleData);

				// Actualizar items localmente
				for (const item of updatedSale.items) {
					await db.saleItems.put({
						...item,
						product: item.product,
					});
				}

				// Actualizar stock y pending_stock_changes CORREGIDO
				for (const [productId, delta] of stockDeltas) {
					const product = await db.products.get(productId);
					if (product) {
						// Stock local: ajustar según el delta
						const newStock = Math.max(0, product.stock + delta);
						
						// Pending_stock_changes: acumular la diferencia neta
						const pendingChange = (product.pending_stock_changes || 0) + (-delta);
	
						await db.products.update(productId, {
							stock: newStock,
							pending_stock_changes: pendingChange,
						});
	
						console.log('[UPDATE_SALE] Producto actualizado:', {
							productId,
							delta,
							newStock,
							pendingChange,
						});
					}
				}

				// Agregar operaciones pendientes
				await db.addPendingOperation(
					'update',
					'sales',
					saleData,
					2 // Alta prioridad para la venta
				);

				// Agregar operaciones para actualizar items
				for (const item of updatedSale.items) {
					await db.addPendingOperation(
						'update', // Usamos 'create' pero realmente actualizará
						'sale_items',
						{
							id: item.id,
							sale_id: updatedSale.id,
							product_id: item.product.id,
							quantity: item.quantity,
							price: item.price,
							created_at: item.created_at,
						},
						1 // Prioridad media para items
					);
				}
			}

			// Actualizar el estado local inmediatamente
			set((state) => ({
				sales: state.sales.map((sale) => (sale.id === updatedSale.id ? updatedSale : sale)),
			}));

			await get().loadSales();
			await useProductsStore.getState().loadProducts();

			console.log('[UPDATE_SALE] Actualización completada exitosamente');
		} catch (error) {
			console.error('[UPDATE_SALE] Error al actualizar venta:', error);
			throw error;
		}
	},

	syncPendingSales: async () => {
		if (!get().isOnline) return;
	  
		try {
		  console.log('[SYNC] Iniciando sincronización de ventas...');
		  const pendingOperations = await db.getPendingOperations();
	  
		  // Procesar operaciones en orden de prioridad
		  for (const op of pendingOperations) {
			try {
			  console.log(`[SYNC] Procesando operación:`, {
				id: op.id,
				type: op.type,
				table: op.table,
				priority: op.priority
			  });
	  
			  	// Sincronizar cambios de stock
		  		await useProductsStore.getState().syncPendingOperations();
			
			  // Manejar operaciones de items primero
			  if (op.table === 'sale_items') {
				switch (op.type) {
				  case 'create':
				  case 'update':
					// Actualizar o crear item
					const { error: itemError } = await supabase
					  .from('sale_items')
					  [op.type === 'create' ? 'insert' : 'update'](op.data)
					  .eq('id', op.data.id);
	  
					if (itemError) throw itemError;
					await db.pendingOperations.delete(op.id);
					break;
	  
				  case 'delete':
					const { error: deleteError } = await supabase
					  .from('sale_items')
					  .delete()
					  .eq('id', op.data.id);
	  
					if (deleteError) throw deleteError;
					await db.pendingOperations.delete(op.id);
					break;
				}
				continue;
			  }
	  
			  // Manejar operaciones de ventas
			  if (op.type === 'update' && op.table === 'sales') {
				console.log('[SYNC] Actualizando venta:', op.data.id);
				
				// 1. Actualizar la venta principal
				const { error: saleError } = await supabase
				  .from('sales')
				  .update(op.data)
				  .eq('id', op.data.id);
	  
				if (saleError) throw saleError;
	  
				// 2. Actualizar items relacionados
				const itemOperations = pendingOperations.filter(
				  itemOp => 
					itemOp.table === 'sale_items' && 
					itemOp.data.sale_id === op.data.id
				);
	  
				// Procesar items en orden de creación
				for (const itemOp of itemOperations) {
				  const { error: itemError } = await supabase
					.from('sale_items')
					[itemOp.type === 'create' ? 'insert' : 'update'](itemOp.data)
					.eq('id', itemOp.data.id);
	  
				  if (!itemError) {
					await db.pendingOperations.delete(itemOp.id);
				  }
				}
	  
				await db.pendingOperations.delete(op.id);
				console.log('[SYNC] Venta actualizada exitosamente:', op.data.id);
			  }
	  
			} catch (error) {
			  console.error(`[SYNC] Error procesando operación ${op.id}:`, error);
			  await db.updateOperationStatus(op.id, 'error', error.message);
			}
		  }
	  
		//   // Sincronizar cambios de stock
		//   await useProductsStore.getState().syncPendingOperations(); // llevado arriba de cosnt op of pendingOperations
		  
		  // Actualizar datos locales
		  await get().loadSales();
		  console.log('[SYNC] Sincronización completada exitosamente');
	  
		} catch (error) {
		  console.error('[SYNC] Error en sincronización:', error);
		  throw error;
		}
	}
}));

// Función para procesar y organizar los datos de ventas
async function processSalesData(sales: SaleWithItems[], set: (state: Partial<SalesState>) => void) {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

	const todaySales = sales.filter((sale) => new Date(sale.date) >= today);
	const yesterdaySales = sales.filter((sale) => new Date(sale.date) >= yesterday && new Date(sale.date) < today);
	const monthSales = sales.filter((sale) => new Date(sale.date) >= firstDayOfMonth);

	// Actualizar estado con nuevos cálculos
	set({
		sales,
		todaySales: todaySales.reduce((sum, sale) => sum + sale.total, 0),
		yesterdaySales: yesterdaySales.reduce((sum, sale) => sum + sale.total, 0),
		monthSales: monthSales.reduce((sum, sale) => sum + sale.total, 0),
		totalSales: sales.reduce((sum, sale) => sum + sale.total, 0),
		todaySalesList: todaySales,
		yesterdaySalesList: yesterdaySales,
		monthSalesList: monthSales,
		allSales: sales,
	});
}
