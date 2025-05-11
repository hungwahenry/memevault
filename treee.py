import os
import sys

def print_tree(directory, indent=""):
    try:
        items = sorted(os.listdir(directory))
    except Exception as e:
        print(f"Error reading {directory}: {e}")
        return

    # Exclude any items that have 'pycache' in their name.
    items = [item for item in items if '.git' not in item.lower()]
    items = [item for item in items if 'treee' not in item.lower()]
    items = [item for item in items if 'logs' not in item.lower()]
    items = [item for item in items if 'tweets' not in item.lower()]
    items = [item for item in items if 'requirements' not in item.lower()]
    items = [item for item in items if 'node_modules' not in item.lower()]
    for count, item in enumerate(items):
        path = os.path.join(directory, item)
        is_last = (count == len(items) - 1)
        connector = "└── " if is_last else "├── "
        print(indent + connector + item)
        if os.path.isdir(path):
            extension = "    " if is_last else "│   "
            print_tree(path, indent + extension)

if __name__ == "__main__":
    # If a directory is provided as an argument, use it; otherwise, use the current directory.
    root_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    print(f"Listing tree for: {root_dir}")
    print(root_dir)
    print_tree(root_dir)
