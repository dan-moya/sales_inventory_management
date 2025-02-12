import { supabase } from './supabase';

export async function setupStorage() {
  try {
    // Crear el bucket si no existe
    const { data: buckets } = await supabase.storage.listBuckets();
    const productsBucket = buckets?.find(b => b.name === 'products');
    
    if (!productsBucket) {
      const { error: createError } = await supabase.storage.createBucket('products', {
        public: true,
        fileSizeLimit: 1024 * 1024 * 2, // 2MB limit
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
      });
      
      if (createError) {
        console.error('Error al crear el bucket:', createError);
        return;
      }
    }

    // Las políticas se configuran a través de las migraciones de SQL
    console.log('Storage configurado correctamente');
  } catch (error) {
    console.error('Error al configurar storage:', error);
  }
}