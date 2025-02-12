import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = 'https://mggdwlrpjfpwdfdotdln.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nZ2R3bHJwamZwd2RmZG90ZGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU5MzQzMTIsImV4cCI6MjA1MTUxMDMxMn0.vCY-7hT7RkvtPp6T__3csbm7k5kUfD5eMfLvf0jaAII';

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);