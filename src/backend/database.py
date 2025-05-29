import os
import pyodbc
from dotenv import load_dotenv
from datetime import datetime, timedelta
import pytz

# Define timezone constant for application (GMT+3)
TIMEZONE = pytz.timezone('Europe/Istanbul')  # Turkey is in GMT+3

# Define shift breaks
SHIFT_BREAKS = {
    'a': {'start': '10:00', 'end': '10:15'},
    'b': {'start': '12:00', 'end': '12:30'},
    'c': {'start': '16:00', 'end': '16:15'},
    'd': {'start': '18:00', 'end': '18:30'},
    'e': {'start': '20:00', 'end': '20:30'},
    'f': {'start': '22:00', 'end': '22:15'},
    'g': {'start': '00:00', 'end': '00:30'},
    'h': {'start': '03:00', 'end': '03:15'},
    'i': {'start': '05:00', 'end': '05:30'}
}

# Define which breaks apply to each working mode
WORKING_MODE_BREAKS = {
    'mode1': ['a', 'b', 'e', 'f', 'h', 'i'],
    'mode2': ['a', 'b', 'c', 'f', 'g', 'h', 'i'],
    'mode3': ['a', 'b', 'c', 'd', 'f', 'g', 'h', 'i']
}

def calculate_break_time(start_time, end_time, working_mode='mode1'):
    """
    Calculate total break time that occurred between start_time and end_time
    based on the working mode.
    """
    if working_mode not in WORKING_MODE_BREAKS:
        working_mode = 'mode1'  # Default fallback
    
    applicable_breaks = WORKING_MODE_BREAKS[working_mode]
    total_break_seconds = 0
    
    # Convert start and end times to same timezone
    if start_time.tzinfo != TIMEZONE:
        start_time = start_time.astimezone(TIMEZONE)
    if end_time.tzinfo != TIMEZONE:
        end_time = end_time.astimezone(TIMEZONE)
    
    for break_id in applicable_breaks:
        break_info = SHIFT_BREAKS[break_id]
        
        # Parse break times
        break_start_time = datetime.strptime(break_info['start'], '%H:%M').time()
        break_end_time = datetime.strptime(break_info['end'], '%H:%M').time()
        
        # Handle breaks that might span multiple days
        current_date = start_time.date()
        end_date = end_time.date()
        
        # Check breaks for each day in the range
        while current_date <= end_date:
            # Create datetime objects for this break on current_date
            break_start_dt = datetime.combine(current_date, break_start_time)
            break_end_dt = datetime.combine(current_date, break_end_time)
            
            # Handle midnight-crossing breaks (00:00-00:30)
            if break_start_time > break_end_time:
                break_end_dt = break_end_dt + timedelta(days=1)
            
            # Convert to timezone-aware datetime
            break_start_dt = TIMEZONE.localize(break_start_dt)
            break_end_dt = TIMEZONE.localize(break_end_dt)
            
            # Check if this break overlaps with our time range
            overlap_start = max(start_time, break_start_dt)
            overlap_end = min(end_time, break_end_dt)
            
            if overlap_start < overlap_end:
                overlap_seconds = (overlap_end - overlap_start).total_seconds()
                total_break_seconds += overlap_seconds
            
            current_date += timedelta(days=1)
    
    return total_break_seconds

load_dotenv()

def get_db_connection():
    try:
        conn = pyodbc.connect(
            f'DRIVER={{ODBC Driver 18 for SQL Server}};'
            f'SERVER={os.getenv("DB_SERVER")};'
            f'DATABASE={os.getenv("DB_NAME")};'
            f'UID={os.getenv("DB_USER")};'
            f'PWD={os.getenv("DB_PASSWORD")};'
            'Trusted_Connection=no;'
            'TrustServerCertificate=yes;'
            'Encrypt=yes;'
        )
        return conn
    except pyodbc.Error as e:
        print(f"Error connecting to database: {str(e)}")
        print(f"Using connection string parameters:")
        print(f"Server: {os.getenv('DB_SERVER')}")
        print(f"Database: {os.getenv('DB_NAME')}")
        print(f"User: {os.getenv('DB_USER')}")
        raise

def get_production_units():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT UnitName FROM ProductRecordLogView ORDER BY UnitName")
    units = [row[0] for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return units

def get_production_data(unit_name, start_time, end_time, current_time=None, working_mode='mode1'):
    # print("\n=== get_production_data called ===")
    # print(f"Input parameters:")
    # print(f"- Unit name: {unit_name}")
    # print(f"- Start time: {start_time} (type: {type(start_time)}, tzinfo: {start_time.tzinfo})")
    # print(f"- End time: {end_time} (type: {type(end_time)}, tzinfo: {end_time.tzinfo})")
    # if current_time:
    #     print(f"- Current time: {current_time} (type: {type(current_time)}, tzinfo: {current_time.tzinfo})")
    
    # If current_time is not provided, use end_time
    actual_end_time = current_time if current_time else end_time
    
    # Ensure all datetimes use the same timezone (GMT+3)
    if start_time.tzinfo is None:
        start_time = TIMEZONE.localize(start_time)
    elif start_time.tzinfo != TIMEZONE:
        start_time = start_time.astimezone(TIMEZONE)
        
    if actual_end_time.tzinfo is None:
        actual_end_time = TIMEZONE.localize(actual_end_time)
    elif actual_end_time.tzinfo != TIMEZONE:
        actual_end_time = actual_end_time.astimezone(TIMEZONE)
    
    # Ensure actual_end_time is not before start_time
    if actual_end_time < start_time:
        actual_end_time = start_time
        # print(f"Warning: Adjusted actual_end_time to match start_time as it was earlier")
    
    # For database query, always use the original end_time but ensure proper timezone
    query_end_time = end_time
    if query_end_time.tzinfo is None:
        query_end_time = TIMEZONE.localize(query_end_time)
    elif query_end_time.tzinfo != TIMEZONE:
        query_end_time = query_end_time.astimezone(TIMEZONE)
    
    # print(f"All times normalized to GMT+3 (Europe/Istanbul)")
    # print(f"Normalized query times: {start_time} to {query_end_time}")
    # print(f"Using operational end time: {actual_end_time}")
    
    # Use the actual end time provided by the frontend (for proper shift boundaries)
    # But update to current time if it's a real-time query
    final_query_end_time = query_end_time
    if current_time:
        # If current_time is provided, use it (for real-time updates)
        final_query_end_time = actual_end_time
    
    # print(f"Final query end time: {final_query_end_time}")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Now execute the main query with the specified time range
    query = """
    SELECT 
        Model,
        SUM(CASE WHEN TestSonucu = 1 THEN 1 ELSE 0 END) as SuccessQty,
        SUM(CASE WHEN TestSonucu = 0 THEN 1 ELSE 0 END) as FailQty,
        ModelSuresiSN as Target
    FROM 
        ProductRecordLogView
    WHERE 
        UnitName = ? 
        AND KayitTarihi BETWEEN ? AND ?
    GROUP BY 
        Model, ModelSuresiSN
    """
    
    # print(f"\nExecuting main query for time range:")
    # print(f"Start: {start_time}")
    # print(f"Query End: {final_query_end_time}")
    # if current_time:
    #     print(f"Operation End (Current): {actual_end_time}")
    
    # Use the properly calculated end time instead of always using current time
    cursor.execute(query, (unit_name, start_time, final_query_end_time))
    # print("\nQuery executed successfully with current time")
    
    results = []
    all_rows = cursor.fetchall()
    # print(f"\nFetched {len(all_rows)} rows from main query")
    
    for row in all_rows:
        # print(f"\nProcessing row: {row}")
        model_data = {
            'model': row[0],
            'success_qty': row[1],
            'fail_qty': row[2],
            'target': row[3],
            'total_qty': row[1],  # Changed: now using only success_qty instead of success + fail
            'quality': row[1] / (row[1] + row[2]) if (row[1] + row[2]) > 0 else 0
        }
        
        if row[3]:  # If ModelSuresiSN exists
            ideal_cycle_time = 3600 / row[3]
            # Use actual_end_time (current time) instead of end_time for operation time calculation
            operation_time_total = (actual_end_time - start_time).total_seconds()
            
            # Calculate and subtract break time
            break_time = calculate_break_time(start_time, actual_end_time, working_mode)
            operation_time = operation_time_total - break_time
            
            # Ensure operation time is not negative
            operation_time = max(operation_time, 0)
            
            model_data['performance'] = (model_data['total_qty'] * ideal_cycle_time) / operation_time if operation_time > 0 else 0
            model_data['oee'] = None  # Remove OEE calculation as per requirement #3
            # print(f"Calculated metrics for {row[0]}:")
            # print(f"- Ideal cycle time: {ideal_cycle_time}")
            # print(f"- Total operation time: {operation_time_total} seconds")
            # print(f"- Break time: {break_time} seconds")
            # print(f"- Net operation time: {operation_time} seconds")
            # print(f"- Performance: {model_data['performance']}")
        else:
            model_data['performance'] = None
            model_data['oee'] = None
            # print(f"No target (ModelSuresiSN) for model {row[0]}, skipping performance calculation")
            
        results.append(model_data)
    
    cursor.close()
    conn.close()
    
    # print(f"\nReturning {len(results)} results")
    return results 