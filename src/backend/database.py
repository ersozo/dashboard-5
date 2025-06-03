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
    # Temporarily use ProductRecordLog until combined table is created
    cursor.execute("SELECT DISTINCT UnitName FROM ProductRecordLogView ORDER BY UnitName")
    units = [row[0] for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return units

def get_production_data(unit_name, start_time, end_time, current_time=None, working_mode='mode1'):
    
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
    
    # For database query, always use the original end_time but ensure proper timezone
    query_end_time = end_time
    if query_end_time.tzinfo is None:
        query_end_time = TIMEZONE.localize(query_end_time)
    elif query_end_time.tzinfo != TIMEZONE:
        query_end_time = query_end_time.astimezone(TIMEZONE)
    
    # Detect if this is historical data or live data
    # If end_time is more than 5 minutes before current_time, it's historical data
    final_query_end_time = query_end_time
    
    if current_time:
        time_difference = current_time - query_end_time
        five_minutes = timedelta(minutes=5)
        
        # Only use current_time for live data (end_time is within 5 minutes of current_time)
        if time_difference <= five_minutes:
            # This is live data - use current_time as end_time
            final_query_end_time = actual_end_time
        else:
            # This is historical data - use the original end_time
            final_query_end_time = query_end_time
            # Also update actual_end_time for performance calculations
            actual_end_time = query_end_time
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Now use ProductRecordLogView since it contains all historical data and targets
    table_name = "ProductRecordLogView"
    
    # Single query approach - when combined table is ready, just change table_name above
    query = f"""
    SELECT 
        Model,
        SUM(CASE WHEN TestSonucu = 1 THEN 1 ELSE 0 END) as SuccessQty,
        SUM(CASE WHEN TestSonucu = 0 THEN 1 ELSE 0 END) as FailQty,
        ModelSuresiSN as Target
    FROM 
        {table_name}
    WHERE 
        UnitName = ? 
        AND KayitTarihi BETWEEN ? AND ?
    GROUP BY 
        Model, ModelSuresiSN
    """
    
    cursor.execute(query, (unit_name, start_time, final_query_end_time))

    # print(query)
    
    results = []
    all_rows = cursor.fetchall()
    
    # Calculate operation time once for all models
    operation_time_total = (actual_end_time - start_time).total_seconds()
    
    # Calculate and subtract break time
    break_time = calculate_break_time(start_time, actual_end_time, working_mode)
    operation_time = operation_time_total - break_time
    
    # Ensure operation time is not negative
    operation_time = max(operation_time, 0)
    operation_time_hours = operation_time / 3600
    
    # First pass: create model data with individual theoretical quantities for display
    models_with_target = []
    
    for row in all_rows:
        model_data = {
            'model': row[0],
            'success_qty': row[1],
            'fail_qty': row[2],
            'target': row[3],
            'total_qty': row[1],  # Changed: now using only success_qty instead of success + fail
            'quality': row[1] / (row[1] + row[2]) if (row[1] + row[2]) > 0 else 0,
            'performance': None,
            'oee': None
        }
        
        # Calculate individual theoretical quantity for display purposes
        if row[3] is not None and row[3] > 0:  # Model has target
            # Individual theoretical quantity = operation_time_hours * model_target
            individual_theoretical_qty = operation_time_hours * row[3]
            model_data['theoretical_qty'] = individual_theoretical_qty
            models_with_target.append(model_data)
        else:
            model_data['theoretical_qty'] = 0
            
        results.append(model_data)
    
    # Second pass: Calculate performance using individual approach
    if models_with_target:
        # Calculate individual performance for each model
        for model_data in results:
            if model_data['target'] is not None and model_data['target'] > 0:
                # Individual theoretical quantity = operation_time_hours * model_target
                individual_theoretical_qty = operation_time_hours * model_data['target']
                model_data['theoretical_qty'] = individual_theoretical_qty
                
                # Individual performance = actual / theoretical
                if individual_theoretical_qty > 0:
                    model_data['performance'] = model_data['total_qty'] / individual_theoretical_qty
                else:
                    model_data['performance'] = 0
            else:
                model_data['theoretical_qty'] = 0
                model_data['performance'] = None
    else:
        # No models with targets, set all performances to None
        for model_data in results:
            if model_data['target'] is not None and model_data['target'] > 0:
                model_data['performance'] = 0
    
    cursor.close()
    conn.close()

    # print(results)  
    
    return results 